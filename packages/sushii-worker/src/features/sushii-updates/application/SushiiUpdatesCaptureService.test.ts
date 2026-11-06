import { describe, expect, mock, test } from "bun:test";
import { MessageFlags, MessageType, SnowflakeUtil } from "discord.js";
import pino from "pino";

import type { UpdatePost } from "../domain/UpdatePost";
import type { SushiiUpdatesMetrics } from "../infrastructure/SushiiUpdatesMetrics";
import {
  SushiiUpdatesCaptureService,
  isPublishedUpdate,
} from "./SushiiUpdatesCaptureService";

const BOT_ID = "400000000000000001";
const HOUR = 60 * 60 * 1000;

function idAgo(ms: number): string {
  return SnowflakeUtil.generate({ timestamp: Date.now() - ms }).toString();
}

function setup() {
  const stored = new Map<string, UpdatePost>();
  const savePost = mock(async (post: UpdatePost) => {
    if (stored.has(post.messageId)) {
      return false;
    }
    stored.set(post.messageId, post);
    return true;
  });
  const recordPostCaptured = mock(() => undefined);
  const service = new SushiiUpdatesCaptureService(
    { savePost },
    { recordPostCaptured } as unknown as SushiiUpdatesMetrics,
    pino({ level: "silent" }),
  );
  return { service, stored, recordPostCaptured };
}

describe("isPublishedUpdate", () => {
  const base = {
    id: idAgo(HOUR),
    flags: MessageFlags.Crossposted,
    type: MessageType.Default,
    authorId: "500000000000000001",
  };

  test("a recent crossposted user message is a published update", () => {
    expect(isPublishedUpdate(base, BOT_ID)).toBe(true);
  });

  test.each([
    ["not crossposted", { flags: 0 }],
    ["a system message", { type: MessageType.ChannelPinnedMessage }],
    ["sushii's own message", { authorId: BOT_ID }],
    ["older than a day", { id: idAgo(25 * HOUR) }],
  ])("%s is not", (_name, override) => {
    expect(isPublishedUpdate({ ...base, ...override }, BOT_ID)).toBe(false);
  });
});

describe("SushiiUpdatesCaptureService.capture", () => {
  test("stores a published post once, so edits don't queue it again", async () => {
    const t = setup();
    const message = {
      id: idAgo(HOUR),
      flags: MessageFlags.Crossposted,
      type: MessageType.Default,
      authorId: "500000000000000001",
    };

    expect(await t.service.capture(message, BOT_ID)).toBe(true);
    expect(await t.service.capture(message, BOT_ID)).toBe(false);

    expect(t.stored.get(message.id)?.createdAt.getTime()).toBe(
      SnowflakeUtil.timestampFrom(message.id),
    );
    expect(t.recordPostCaptured).toHaveBeenCalledTimes(1);
  });
});
