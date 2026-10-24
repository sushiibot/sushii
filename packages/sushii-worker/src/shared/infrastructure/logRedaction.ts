// Imported by sushii-mcp, which can't resolve this package's `@/` aliases.
import pino, { type LoggerOptions } from "pino";

// Case-sensitive auth schemes with token-shaped values, so prose like "basic setup" survives.
const URL_TOKENS =
  /(\/(?:webhooks|interactions)\/\d+\/)[^/?\s"]+|([?&](?:key|token|api_key|access_token)=)[^&\s"]+|((?:[Bb]earer)\s+)[A-Za-z0-9._~+/=-]{8,}|(Basic\s+)[A-Za-z0-9+/=]{12,}/g;

export function scrubUrl(s: string): string {
  return s.replace(
    URL_TOKENS,
    (_m, path, query, bearer, basic) =>
      `${path ?? query ?? bearer ?? basic}REDACTED`,
  );
}

export function scrubSecrets(
  s: string,
  known: readonly string[],
): string {
  return known.reduce((acc, v) => acc.split(v).join("[REDACTED]"), scrubUrl(s));
}

const MAX_DEPTH = 10;

function scrubDeep(
  value: unknown,
  known: readonly string[],
  seen: WeakSet<object>,
  depth = 0,
): unknown {
  if (typeof value === "string") {
    return scrubSecrets(value, known);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }

  seen.add(value);
  try {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") {
      try {
        return scrubDeep(toJSON.call(value), known, seen, depth + 1);
      } catch {
        return "[Unserializable]";
      }
    }
    if (Array.isArray(value)) {
      return value.map((v) => scrubDeep(v, known, seen, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = scrubDeep(v, known, seen, depth + 1);
    }
    return out;
  } finally {
    // Ancestors only, so an object referenced twice (not cyclically) is still serialized both times.
    seen.delete(value);
  }
}

// Never throws: it runs inside logger calls, often from catch handlers.
function serializeErr(err: unknown, known: readonly string[]): unknown {
  try {
    return scrubDeep(
      pino.stdSerializers.err(err as Error),
      known,
      new WeakSet(),
    );
  } catch {
    try {
      const e = err as { name?: unknown; message?: unknown } | null | undefined;
      return {
        type: String(e?.name ?? "Error"),
        message: scrubSecrets(String(e?.message), known),
      };
    } catch {
      return { type: "Error", message: "[unserializable error]" };
    }
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function errorMessage(v: unknown): string | undefined {
  return v instanceof Error ||
    (v !== null &&
      typeof v === "object" &&
      typeof (v as { message?: unknown }).message === "string")
    ? String((v as { message: unknown }).message)
    : undefined;
}

/** Scrubs string args, top-level string fields and the message pino would take from an error. */
export function scrubLogArgs(
  args: unknown[],
  known: readonly string[],
): unknown[] {
  const out = args.map((a) =>
    typeof a === "string" ? scrubSecrets(a, known) : a,
  );
  const first = out[0];

  if (first instanceof Error) {
    if (out[1] === undefined) {
      out[1] = scrubSecrets(first.message, known);
    }
  } else if (isPlainObject(first)) {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(first)) {
      copy[k] = typeof v === "string" ? scrubSecrets(v, known) : v;
    }
    const errMsg = errorMessage(first["err"]);
    if (
      out[1] === undefined &&
      copy["msg"] === undefined &&
      errMsg !== undefined
    ) {
      out[1] = scrubSecrets(errMsg, known);
    }
    out[0] = copy;
  }

  return out;
}

/**
 * pino options that censor credential keys and scrub URL tokens plus every
 * value returned by `knownValues` from errors, messages and top-level fields.
 */
export function createRedactionOptions(
  knownValues: () => readonly string[],
): Pick<LoggerOptions, "redact" | "serializers" | "hooks"> {
  return {
    // `*` matches exactly one level, so top-level and nested keys are listed separately.
    redact: {
      paths: [
        "authorization",
        "token",
        "apiKey",
        "*.authorization",
        "*.Authorization",
        "*.headers.authorization",
        "*.headers.Authorization",
        "*.token",
        "*.apiKey",
        "err.requestBody",
      ],
      censor: "[REDACTED]",
    },
    serializers: {
      err: (err: unknown) => serializeErr(err, knownValues()),
      error: (err: unknown) => serializeErr(err, knownValues()),
      cause: (err: unknown) => serializeErr(err, knownValues()),
    },
    hooks: {
      logMethod(args, method) {
        let scrubbed: unknown[];
        try {
          scrubbed = scrubLogArgs(args, knownValues());
        } catch {
          scrubbed = ["[log arguments could not be scrubbed]"];
        }
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
  };
}
