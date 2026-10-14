import { describe, expect, test } from "bun:test";

import {
  type MessageInput,
  MessageUsageDetector,
} from "./MessageUsageDetector";

function message(overrides: Partial<MessageInput>): MessageInput {
  return {
    guildId: "200000000000000002",
    authorId: "300000000000000003",
    channelId: "600000000000000006",
    occurredAt: new Date("2026-10-01T00:00:00Z"),
    mentionsEveryone: false,
    mentionsNonMentionableRole: false,
    tts: false,
    ...overrides,
  };
}

function permissions(input: MessageInput): string[] {
  return new MessageUsageDetector()
    .detect(input)
    .map((usage) => usage.permission);
}

describe("MessageUsageDetector", () => {
  test("plain message uses nothing", () => {
    expect(permissions(message({}))).toEqual([]);
  });

  test("@everyone uses Mention Everyone", () => {
    expect(permissions(message({ mentionsEveryone: true }))).toEqual([
      "MentionEveryone",
    ]);
  });

  test("pinging a non-mentionable role uses Mention Everyone", () => {
    expect(permissions(message({ mentionsNonMentionableRole: true }))).toEqual([
      "MentionEveryone",
    ]);
  });

  test("both mention kinds record once", () => {
    expect(
      permissions(
        message({ mentionsEveryone: true, mentionsNonMentionableRole: true }),
      ),
    ).toEqual(["MentionEveryone"]);
  });

  test("tts uses Send TTS Messages", () => {
    expect(permissions(message({ tts: true }))).toEqual(["SendTTSMessages"]);
  });

  test("records the channel", () => {
    const [usage] = new MessageUsageDetector().detect(
      message({ mentionsEveryone: true }),
    );

    expect(usage?.channelId).toBe("600000000000000006");
    expect(usage?.source).toBe("message");
  });
});
