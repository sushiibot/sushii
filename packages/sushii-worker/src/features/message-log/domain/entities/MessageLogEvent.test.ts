import { describe, expect, test } from "bun:test";

import type { GuildMessageCreatePayload } from "../types/GuildMessagePayloads";
import { MessageLogEvent } from "./MessageLogEvent";

function payload(
  overrides: Record<string, unknown> = {},
): GuildMessageCreatePayload {
  return {
    id: "500000000000000001",
    guild_id: "100000000000000001",
    channel_id: "300000000000000001",
    type: 0,
    author: {
      id: "200000000000000001",
      username: "member",
      discriminator: "0",
      avatar: null,
      global_name: null,
    },
    content: "hello",
    timestamp: "2026-03-10T12:00:00.000Z",
    embeds: [{ title: "link preview", description: "unfurl" }],
    ...overrides,
  } as unknown as GuildMessageCreatePayload;
}

describe("MessageLogEvent.fromRawMessageCreate", () => {
  test("stores member avatar and nick, normalizing missing values to null", () => {
    const event = MessageLogEvent.fromRawMessageCreate(
      payload({ member: { nick: "Nick", roles: [] } }),
    );

    expect(event.discordMessage.member).toEqual({ avatar: null, nick: "Nick" });
  });

  test("does not store embeds for normal member messages", () => {
    const event = MessageLogEvent.fromRawMessageCreate(payload());

    expect(event.discordMessage.embeds).toBeUndefined();
    expect(event.discordMessage.member).toBeUndefined();
    expect(event.discordMessage.interaction_metadata).toBeUndefined();
  });

  test("stores AutoMod alert embed fields for type 24", () => {
    const event = MessageLogEvent.fromRawMessageCreate(
      payload({
        type: 24,
        embeds: [
          {
            type: "auto_moderation_message",
            description: "bad words here",
            fields: [
              { name: "rule_name", value: "No slurs" },
              { name: "channel_id", value: "300000000000000002" },
            ],
            color: 1,
          },
        ],
      }),
    );

    expect(event.discordMessage.embeds).toEqual([
      {
        title: undefined,
        description: "bad words here",
        fields: [
          { name: "rule_name", value: "No slurs" },
          { name: "channel_id", value: "300000000000000002" },
        ],
      },
    ]);
  });

  test("keeps an AutoMod rule name when the flagged message fills the budget", () => {
    const event = MessageLogEvent.fromRawMessageCreate(
      payload({
        type: 24,
        embeds: [
          {
            type: "auto_moderation_message",
            description: "x".repeat(4000),
            fields: [{ name: "rule_name", value: "No slurs" }],
          },
        ],
      }),
    );

    const [embed] = event.discordMessage.embeds ?? [];
    expect(embed.fields).toEqual([{ name: "rule_name", value: "No slurs" }]);
    expect(embed.description?.length).toBeGreaterThan(0);
  });

  test("caps stored embeds to 5 and about 2,000 characters", () => {
    const embeds = Array.from({ length: 8 }, () => ({
      description: "x".repeat(600),
    }));
    const event = MessageLogEvent.fromRawMessageCreate(
      payload({
        author: {
          id: "400000000000000002",
          username: "app",
          discriminator: "0",
          avatar: null,
          global_name: null,
          bot: true,
        },
        embeds,
      }),
    );

    const stored = event.discordMessage.embeds ?? [];
    const total = stored.reduce(
      (sum, e) => sum + (e.description?.length ?? 0),
      0,
    );
    expect(stored.length).toBeLessThanOrEqual(5);
    expect(total).toBe(2000);
  });

  test("stores interaction metadata with the triggering user id", () => {
    const event = MessageLogEvent.fromRawMessageCreate(
      payload({
        interaction_metadata: {
          id: "600000000000000001",
          type: 2,
          user: { id: "200000000000000002", username: "trigger" },
          authorizing_integration_owners: { "1": "200000000000000002" },
          name: "ping",
        },
      }),
    );

    expect(event.discordMessage.interaction_metadata).toEqual({
      id: "600000000000000001",
      type: 2,
      user_id: "200000000000000002",
      authorizing_integration_owners: { "1": "200000000000000002" },
    });
    expect(event.interactionUserId).toBe("200000000000000002");
  });

  test("caps stored embed text by code points without splitting emoji", () => {
    const event = MessageLogEvent.fromRawMessageCreate(
      payload({
        type: 24,
        embeds: [{ description: "😀".repeat(2500) }],
      }),
    );

    const description = event.discordMessage.embeds?.[0].description ?? "";
    expect(Array.from(description)).toHaveLength(2000);
    expect(description).toBe("😀".repeat(2000));
  });
});
