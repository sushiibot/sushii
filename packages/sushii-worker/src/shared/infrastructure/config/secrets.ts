import { readFileSync } from "node:fs";
import { z } from "zod";

const optional = z.string().min(1).optional();

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  INTERNAL_API_TOKEN: optional,
  NOTIFY_WEBHOOK_URL: optional,
  NOTIFY_WEBHOOK_ERR_URL: optional,
  ACTIVITY_WEBHOOK_URL: optional,
  E2E_WEBHOOK_URL: optional,
  SENTRY_DSN: optional,
  GOOGLE_CALENDAR_API_KEY: optional,
  OPENROUTER_API_KEY: optional,
  SCAM_IMAGE_STORE_ACCESS_KEY_ID: optional,
  SCAM_IMAGE_STORE_SECRET_ACCESS_KEY: optional,
});

export type Secrets = Readonly<z.infer<typeof schema>>;
export type SecretName = keyof Secrets;

const WEBHOOK_URL_NAMES = [
  "NOTIFY_WEBHOOK_URL",
  "NOTIFY_WEBHOOK_ERR_URL",
  "ACTIVITY_WEBHOOK_URL",
  "E2E_WEBHOOK_URL",
] as const satisfies readonly SecretName[];

// An auth gate must not silently open because its value rendered empty.
const REJECT_EMPTY = ["INTERNAL_API_TOKEN"] as const satisfies readonly SecretName[];

const extraValues = new Set<string>();
let knownCache: string[] | undefined;

/** One secret by name, with the NAME_FILE fallback; empty counts as unset. */
export function readSecret(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const file = env[`${name}_FILE`];
  if (!file) {
    return env[name] || undefined;
  }

  try {
    return readFileSync(file, "utf8").trimEnd() || undefined;
  } catch (err) {
    throw new Error(
      `${name}_FILE could not be read (${(err as NodeJS.ErrnoException).code})`,
      { cause: err },
    );
  }
}

/** Adds a value derived at runtime to log scrubbing. */
export function registerSecretValue(value: string): void {
  extraValues.add(value);
  knownCache = undefined;
}

export function loadSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  const raw = Object.fromEntries(
    Object.keys(schema.shape).map((k) => [k, readSecret(k, env)]),
  );
  const parsed = schema.safeParse(raw);
  // Names and issue codes only: some zod messages echo the received value.
  const names = parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join(".")} (${i.code})`);
  for (const name of REJECT_EMPTY) {
    const isSet = env[name] !== undefined || env[`${name}_FILE`] !== undefined;
    if (isSet && raw[name] === undefined) {
      names.push(`${name} (empty)`);
    }
  }
  if (!parsed.success || names.length > 0) {
    throw new Error(`Missing or invalid secrets: ${names.join(", ")}`);
  }

  return Object.freeze(parsed.data);
}

/** Webhook ID from a webhook URL; the ID alone is not a credential. */
export function webhookIdFromUrl(url: string | undefined): string | undefined {
  return url?.match(/\/webhooks\/(\d+)\//)?.[1];
}

/**
 * Parts of loaded secrets that appear on their own elsewhere: discord.js
 * rebuilds webhook URLs from the token, and pg errors can carry the password.
 */
export function derivedSecretValues(loaded: Secrets): string[] {
  const values: string[] = [];

  for (const name of WEBHOOK_URL_NAMES) {
    const token = loaded[name]?.match(/\/webhooks\/\d+\/([^/?#\s]+)/)?.[1];
    if (token) {
      values.push(token);
    }
  }

  try {
    const password = new URL(loaded.DATABASE_URL).password;
    if (password) {
      values.push(password);
      values.push(decodeURIComponent(password));
    }
  } catch {
    // Not a URL, or a malformed percent-escape; whatever was pushed stays.
  }

  return values;
}

export const secrets = loadSecrets();

for (const value of derivedSecretValues(secrets)) {
  registerSecretValue(value);
}

/**
 * Values to scrub from logs, longest first so a secret containing another is
 * replaced whole. Shorter than 8 chars is skipped to avoid redacting common words.
 */
export function knownSecretValues(): string[] {
  knownCache ??= [...new Set([...Object.values(secrets), ...extraValues])]
    .filter((v): v is string => typeof v === "string" && v.length >= 8)
    .sort((a, b) => b.length - a.length);
  return knownCache;
}
