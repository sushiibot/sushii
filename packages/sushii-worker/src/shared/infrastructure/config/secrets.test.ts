import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { derivedSecretValues, loadSecrets, webhookIdFromUrl } from "./secrets";

const REQUIRED = {
  DISCORD_TOKEN: "discord-token-value",
  DATABASE_URL: "postgres://sushii:pg-pass-value@db:5432/sushii",
};

describe("loadSecrets", () => {
  test("a missing required secret names the variable and never echoes a value", () => {
    let message = "";
    try {
      loadSecrets({
        DISCORD_TOKEN: "",
        OPENROUTER_API_KEY: "openrouter-should-not-appear",
      });
    } catch (e) {
      message = String(e);
    }

    expect(message).toContain("DISCORD_TOKEN");
    expect(message).toContain("DATABASE_URL");
    expect(message).not.toContain("OPENROUTER_API_KEY");
    expect(message).not.toContain("openrouter-should-not-appear");
  });

  test("NAME_FILE is read when set, trailing newline trimmed", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-"));
    try {
      const file = join(dir, "discord");
      writeFileSync(file, "from-file-token\n");

      const loaded = loadSecrets({
        DATABASE_URL: REQUIRED.DATABASE_URL,
        DISCORD_TOKEN_FILE: file,
      });

      expect(loaded.DISCORD_TOKEN).toBe("from-file-token");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NAME_FILE takes precedence over NAME", () => {
    const dir = mkdtempSync(join(tmpdir(), "secrets-"));
    try {
      const file = join(dir, "asset");
      writeFileSync(file, "asset-from-file");

      const loaded = loadSecrets({
        ...REQUIRED,
        ASSET_KEY: "asset-from-env",
        ASSET_KEY_FILE: file,
      });

      expect(loaded.ASSET_KEY).toBe("asset-from-file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("an empty INTERNAL_API_TOKEN fails instead of leaving the API open", () => {
    expect(() => loadSecrets({ ...REQUIRED, INTERNAL_API_TOKEN: "" })).toThrow(
      "INTERNAL_API_TOKEN (empty)",
    );
    expect(loadSecrets(REQUIRED).INTERNAL_API_TOKEN).toBeUndefined();
  });

  test("an unreadable NAME_FILE names the variable and the error code only", () => {
    expect(() =>
      loadSecrets({ ...REQUIRED, ASSET_KEY_FILE: "/nonexistent/asset" }),
    ).toThrow("ASSET_KEY_FILE could not be read (ENOENT)");
  });

  test("an empty optional secret counts as unset, and the result is frozen", () => {
    const loaded = loadSecrets({ ...REQUIRED, SENTRY_DSN: "" });

    expect(loaded.SENTRY_DSN).toBeUndefined();
    expect(Object.isFrozen(loaded)).toBe(true);
  });
});

describe("derivedSecretValues", () => {
  test("includes webhook tokens and the database password", () => {
    const loaded = loadSecrets({
      ...REQUIRED,
      NOTIFY_WEBHOOK_URL:
        "https://discord.com/api/webhooks/123456789012345678/notify-webhook-tok",
    });

    expect(derivedSecretValues(loaded)).toEqual(
      expect.arrayContaining(["notify-webhook-tok", "pg-pass-value"]),
    );
  });

  test("a password with a malformed percent-escape is still included", () => {
    const loaded = loadSecrets({
      ...REQUIRED,
      DATABASE_URL: "postgres://sushii:bad%zzpass@db:5432/sushii",
    });

    expect(derivedSecretValues(loaded)).toContain("bad%zzpass");
  });
});

test("webhookIdFromUrl returns only the ID", () => {
  expect(
    webhookIdFromUrl("https://discord.com/api/webhooks/123456789012345678/tok"),
  ).toBe("123456789012345678");
  expect(webhookIdFromUrl(undefined)).toBeUndefined();
});
