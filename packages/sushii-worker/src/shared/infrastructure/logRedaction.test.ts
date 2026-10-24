import { describe, expect, test } from "bun:test";
import { Writable } from "node:stream";
import pino from "pino";

import {
  knownSecretValues,
  registerSecretValue,
} from "@/shared/infrastructure/config/secrets";

import { createRedactionOptions, scrubUrl } from "./logRedaction";

function capture(): { log: pino.Logger; output: () => string } {
  let out = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  return { log: pino(createRedactionOptions(knownSecretValues), stream), output: () => out };
}

const INTERACTION_TOKEN = "aW50ZXJhY3Rpb246MTIzNDU2Nzg5MDEyMzQ1Njc4OjEyMzQ1Njc4OTAxMjM0NTY";

describe("scrubUrl", () => {
  test("masks webhook and interaction path tokens and token-bearing query values", () => {
    expect(
      scrubUrl("https://discord.com/api/v10/webhooks/123/abcDEF_tok?wait=true"),
    ).toBe("https://discord.com/api/v10/webhooks/123/REDACTED?wait=true");
    expect(
      scrubUrl(
        "https://discord.com/api/v10/interactions/456/aW50ZXJhY3Rpb24/callback",
      ),
    ).toBe("https://discord.com/api/v10/interactions/456/REDACTED/callback");
    expect(scrubUrl("https://www.googleapis.com/x?a=1&key=s3cret&b=2")).toBe(
      "https://www.googleapis.com/x?a=1&key=REDACTED&b=2",
    );
  });

  test("leaves ordinary prose alone", () => {
    expect(scrubUrl("using basic auth for basic setup")).toBe(
      "using basic auth for basic setup",
    );
  });
});

describe("logger redaction", () => {
  test("a DiscordAPIError-style url with an interaction token is scrubbed", () => {
    const { log, output } = capture();
    const err = Object.assign(new Error("Unknown Webhook"), {
      url: `https://discord.com/api/v10/webhooks/123456789012345678/${INTERACTION_TOKEN}/messages/@original`,
      method: "PATCH",
    });

    log.error({ err }, "Failed to edit reply");

    expect(output()).not.toContain(INTERACTION_TOKEN);
    expect(output()).toContain("webhooks/123456789012345678/REDACTED/messages");
  });

  test("errors logged under error or cause are scrubbed like err", () => {
    const { log, output } = capture();
    const e = Object.assign(new Error("Unknown Webhook"), {
      url: "https://discord.com/api/v10/webhooks/1/error-key-webhook-tok",
    });

    log.error({ error: e, cause: e }, "failed");

    expect(output()).not.toContain("error-key-webhook-tok");
  });

  test("child loggers inherit scrubbing", () => {
    registerSecretValue("child-logger-secret-123");
    const { log, output } = capture();

    log
      .child({ module: "Test" })
      .error(
        { err: new Error("bad key child-logger-secret-123") },
        "call failed",
      );

    expect(output()).not.toContain("child-logger-secret-123");
    expect(output()).toContain("[REDACTED]");
  });

  test("authorization headers are censored by path", () => {
    const { log, output } = capture();

    log.info(
      {
        req: { headers: { authorization: "Bot nested-header-secret" } },
        authorization: "Bearer top-level-secret",
      },
      "req",
    );

    expect(output()).not.toContain("nested-header-secret");
    expect(output()).not.toContain("top-level-secret");
  });

  test("an Error logged directly has its message scrubbed in msg", () => {
    const { log, output } = capture();

    log.error(
      new Error(
        "post to https://discord.com/api/v10/webhooks/1/msg-webhook-tok failed",
      ),
    );

    expect(output()).not.toContain("msg-webhook-tok");
    expect(JSON.parse(output()).msg).toContain("webhooks/1/REDACTED");
  });

  test("the err serializer survives cyclic and BigInt fields", () => {
    const { log, output } = capture();
    const ctx: Record<string, unknown> = {};
    ctx["back"] = ctx;
    const err = Object.assign(new Error("cyclic"), { n: 10n, ctx });

    expect(() => log.error({ err }, "failed")).not.toThrow();
    expect(output()).toContain("[Circular]");
    expect(output()).toContain('"n":"10"');
  });
});

// `secrets` loads at import, so the env-loaded case needs a fresh process.
test("secrets loaded from env, and their derived parts, are scrubbed by the app logger", async () => {
  const script = `const { newModuleLogger } = await import("@/shared/infrastructure/logger");
newModuleLogger("Test").error(
  { err: new Error("bad key env-openrouter-key-123, pw env-pg-pass-123, hook env-webhook-tok-123") },
  "failed",
);`;
  const proc = Bun.spawn([process.execPath, "--no-env-file", "-e", script], {
    cwd: `${import.meta.dir}/../../..`,
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      DEPLOYMENT_NAME: "blue",
      APPLICATION_ID: "1",
      DISCORD_TOKEN: "env-discord-token-123",
      DATABASE_URL: "postgres://sushii:env-pg-pass-123@db:5432/sushii",
      OPENROUTER_API_KEY: "env-openrouter-key-123",
      NOTIFY_WEBHOOK_URL:
        "https://discord.com/api/webhooks/123456789012345678/env-webhook-tok-123",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(code, err).toBe(0);
  expect(out).toContain("[REDACTED]");
  expect(out).not.toContain("env-openrouter-key-123");
  expect(out).not.toContain("env-pg-pass-123");
  expect(out).not.toContain("env-webhook-tok-123");
});
