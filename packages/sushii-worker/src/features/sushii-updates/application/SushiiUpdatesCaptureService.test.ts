import { describe, expect, mock, test } from "bun:test";
import { MessageFlags, MessageType, SnowflakeUtil } from "discord.js";
import pino from "pino";

import type { UpdatePost } from "../domain/UpdatePost";
import type { SushiiUpdatesMetrics } from "../infrastructure/SushiiUpdatesMetrics";
import {
  SushiiUpdatesCaptureService,
  isPublishedUpdate,
} from "./SushiiUpdatesCaptureService";

const SOURCE = "300000000000000001";
const BOT_ID = "400000000000000001";
const HOUR = 60 * 60 * 1000;

function idAgo(ms: number): string {
  return SnowflakeUtil.generate({ timestamp: Date.now() - ms }).toString();
}

function setup(messages: unknown[] = []) {
  const stored = new Map<string, UpdatePost>();
  const savePost = mock(async (post: UpdatePost) => {
    if (stored.has(post.messageId)) {
      return false;
    }
    stored.set(post.messageId, post);
    return true;
  });
  const get = mock(async () => messages);
  const recordPostCaptured = mock(() => undefined);
  const service = new SushiiUpdatesCaptureService(
    { get } as never,
    SOURCE,
    { savePost },
    { recordPostCaptured } as unknown as SushiiUpdatesMetrics,
    pino({ level: "silent" }),
  );
  return { service, stored, get, recordPostCaptured };
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

describe("SushiiUpdatesCaptureService.catchUp", () => {
  test("captures recent published posts once from the last messages", async () => {
    const published = idAgo(HOUR);
    const t = setup([
      {
        id: published,
        flags: MessageFlags.Crossposted,
        type: MessageType.Default,
        author: { id: "500000000000000001" },
      },
      {
        id: idAgo(2 * HOUR),
        flags: 0,
        type: MessageType.Default,
        author: { id: "500000000000000001" },
      },
      {
        id: idAgo(48 * HOUR),
        flags: MessageFlags.Crossposted,
        type: MessageType.Default,
        author: { id: "500000000000000001" },
      },
    ]);

    await t.service.catchUp(BOT_ID);
    await t.service.catchUp(BOT_ID);

    expect([...t.stored.keys()]).toEqual([published]);
    expect(t.stored.get(published)?.createdAt.getTime()).toBe(
      SnowflakeUtil.timestampFrom(published),
    );
    expect(t.recordPostCaptured).toHaveBeenCalledTimes(1);
    expect(t.get).toHaveBeenCalledWith(`/channels/${SOURCE}/messages`, {
      query: new URLSearchParams({ limit: "10" }),
    });
  });
});
