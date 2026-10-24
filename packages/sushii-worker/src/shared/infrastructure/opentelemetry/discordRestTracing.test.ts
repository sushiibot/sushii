import { describe, expect, test } from "bun:test";

import { normalizeDiscordPath } from "./discordRestTracing";

describe("normalizeDiscordPath", () => {
  test("a short webhook token is replaced by its position", () => {
    const token = "a".repeat(68);

    expect(
      normalizeDiscordPath(
        `https://discord.com/api/v10/webhooks/123456789012345678/${token}?wait=true`,
      ),
    ).toBe("/api/v10/webhooks/{id}/{token}");
  });

  test("interaction callback tokens are replaced", () => {
    expect(
      normalizeDiscordPath(
        "https://discord.com/api/v10/interactions/123456789012345678/shorttok/callback",
      ),
    ).toBe("/api/v10/interactions/{id}/{token}/callback");
  });

  test("followup message paths keep the message route", () => {
    expect(
      normalizeDiscordPath(
        "https://discord.com/api/v10/webhooks/123456789012345678/tok/messages/@original",
      ),
    ).toBe("/api/v10/webhooks/{id}/{token}/messages/@original");
  });

  test("a trailing slash after the webhook ID is not taken as a token", () => {
    expect(
      normalizeDiscordPath(
        "https://discord.com/api/v10/webhooks/123456789012345678/",
      ),
    ).toBe("/api/v10/webhooks/{id}/");
  });

  test("routes without a token are unchanged apart from IDs", () => {
    expect(
      normalizeDiscordPath(
        "https://discord.com/api/v10/channels/123456789012345678/webhooks",
      ),
    ).toBe("/api/v10/channels/{id}/webhooks");
    expect(
      normalizeDiscordPath(
        "https://discord.com/api/v10/webhooks/123456789012345678",
      ),
    ).toBe("/api/v10/webhooks/{id}");
  });
});
