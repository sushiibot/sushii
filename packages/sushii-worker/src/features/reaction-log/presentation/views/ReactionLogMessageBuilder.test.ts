import { describe, expect, test } from "bun:test";
import { EmbedBuilder } from "discord.js";

import type {
  ReactionBatch,
  ReactionEvent,
} from "../domain/types/ReactionEvent";
import { createReactionLogMessage } from "../presentation/views/ReactionLogMessageBuilder";

describe("ReactionLogMessageBuilder", () => {
  const mockBatch: ReactionBatch = {
    messageId: "123456789",
    channelId: "987654321",
    guildId: "555666777",
    startTime: new Date("2023-01-01T12:00:00Z"),
    actions: [],
  };

  test("should create a single embed for small batches", () => {
    const actions: ReactionEvent[] = [
      {
        messageId: "123456789",
        channelId: "987654321",
        guildId: "555666777",
        userId: "user1",
        emoji: "👍",
        emojiName: "👍",
        type: "add",
        timestamp: new Date(),
        isInitial: true,
        userName: "TestUser1",
      },
      {
        messageId: "123456789",
        channelId: "987654321",
        guildId: "555666777",
        userId: "user2",
        emoji: "👍",
        emojiName: "👍",
        type: "add",
        timestamp: new Date(),
        isInitial: false,
        userName: "TestUser2",
      },
    ];

    const batch = { ...mockBatch, actions };
    const result = createReactionLogMessage(batch);

    expect(result.embeds).toHaveLength(1);
    expect(result.embeds[0]).toBeInstanceOf(EmbedBuilder);

    const description = result.embeds[0].data.description || "";
    expect(description).toContain("📊 Reaction Activity");
    expect(description).toContain("TestUser1 (started)");
    expect(description).toContain("TestUser2");
    expect(description).toContain("👍");
  });

  test("should create multiple embeds for large batches with many users", () => {
    // Create a large batch with many reactions to trigger splitting
    const actions: ReactionEvent[] = [];

    // Create 100 users reacting with different emojis
    for (let i = 0; i < 100; i++) {
      actions.push({
        messageId: "123456789",
        channelId: "987654321",
        guildId: "555666777",
        userId: `user${i}`,
        emoji: i < 50 ? "👍" : "👎",
        emojiName: i < 50 ? "👍" : "👎",
        type: "add",
        timestamp: new Date(),
        isInitial: i === 0 || i === 50, // First users start each emoji
        userName: `TestUser${i}WithAVeryLongUsernameThatTakesUpSpace`,
      });
    }

    const batch = { ...mockBatch, actions };
    const result = createReactionLogMessage(batch);

    // Should create multiple embeds due to the large amount of content
    expect(result.embeds.length).toBeGreaterThan(1);

    // First embed should contain the main header
    const firstDescription = result.embeds[0].data.description || "";
    expect(firstDescription).toContain("📊 Reaction Activity");
    expect(firstDescription).toContain(
      "https://discord.com/channels/555666777/987654321/123456789",
    );

    // Continuation embeds should be marked as continued
    if (result.embeds.length > 1) {
      const continuationDescription = result.embeds[1].data.description || "";
      expect(continuationDescription).toContain("(Continued)");
    }

    // All embeds should have reasonable length (under Discord limits)
    for (const embed of result.embeds) {
      const description = embed.data.description || "";
      expect(description.length).toBeLessThanOrEqual(4096);
    }
  });

  test("should preserve all reaction data without truncation", () => {
    const actions: ReactionEvent[] = [];

    // Create exactly 10 users for one emoji - previously this would be truncated at 5
    for (let i = 0; i < 10; i++) {
      actions.push({
        messageId: "123456789",
        channelId: "987654321",
        guildId: "555666777",
        userId: `user${i}`,
        emoji: "🎉",
        emojiName: "🎉",
        type: "add",
        timestamp: new Date(),
        isInitial: i === 0,
        userName: `User${i}`,
      });
    }

    const batch = { ...mockBatch, actions };
    const result = createReactionLogMessage(batch);

    // All embeds combined should contain all 10 users
    const allContent = result.embeds
      .map((embed) => embed.data.description || "")
      .join(" ");

    // Check that all users are mentioned (no truncation)
    for (let i = 0; i < 10; i++) {
      expect(allContent).toContain(`User${i}`);
    }

    // Should not contain any "+X more" text since we preserve all data
    expect(allContent).not.toContain("more)");
  });
});
