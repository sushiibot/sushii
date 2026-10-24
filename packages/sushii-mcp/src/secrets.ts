import { readFileSync } from "node:fs";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  MCP_AUTH_TOKEN: z.string().min(1),
});

export type Secrets = Readonly<z.infer<typeof schema>>;

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

export function loadSecrets(env: NodeJS.ProcessEnv = process.env): Secrets {
  const raw = Object.fromEntries(
    Object.keys(schema.shape).map((k) => [k, readSecret(k, env)]),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Names and issue codes only: some zod messages echo the received value.
    const names = parsed.error.issues.map(
      (i) => `${i.path.join(".")} (${i.code})`,
    );
    throw new Error(`Missing or invalid secrets: ${names.join(", ")}`);
  }

  return Object.freeze(parsed.data);
}

export const secrets = loadSecrets();

function databasePassword(url: string): string[] {
  const values: string[] = [];
  try {
    const password = new URL(url).password;
    if (password) {
      values.push(password);
      values.push(decodeURIComponent(password));
    }
  } catch {
    // Not a URL, or a malformed percent-escape; whatever was pushed stays.
  }
  return values;
}

// Longest first so a secret containing another is replaced whole.
const knownValues = [
  ...new Set([
    ...Object.values(secrets),
    ...databasePassword(secrets.DATABASE_URL),
  ]),
]
  .filter((v) => v.length >= 8)
  .sort((a, b) => b.length - a.length);

export function knownSecretValues(): readonly string[] {
  return knownValues;
}
