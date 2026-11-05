import { describe, expect, mock, test } from "bun:test";
import {
  DiscordAPIError,
  MessageFlags,
  MessageFlagsBitField,
  MessageType,
  RESTJSONErrorCodes,
  SnowflakeUtil,
} from "discord.js";
import pino from "pino";

import { SushiiUpdatesCaptureService } from "../../application/SushiiUpdatesCaptureService";
import type { UpdatePost } from "../../domain/UpdatePost";
import type { SushiiUpdatesMetrics } from "../../infrastructure/SushiiUpdatesMetrics";
import { UpdatesPublishHandler } from "./UpdatesPublishHandler";

const SOURCE = "300000000000000001";
const BOT_ID = "400000000000000001";
const HOUR = 60 * 60 * 1000;

type Published = Parameters<UpdatesPublishHandler["handle"]>[1];

function message(
  opts: {
    flags?: number;
    channelId?: string;
    partial?: boolean;
    ageMs?: number;
  } = {},
) {
  const full = {
    id: SnowflakeUtil.generate({
      timestamp: Date.now() - (opts.ageMs ?? HOUR),
    }).toString(),
    channelId: opts.channelId ?? SOURCE,
    partial: false,
    flags: new MessageFlagsBitField(opts.flags ?? 0),
    type: MessageType.Default,
    author: { id: "500000000000000001" },
    client: { user: { id: BOT_ID } },
  };
  if (!opts.partial) {
    return full as unknown as Published;
  }
  return {
    id: full.id,
    channelId: full.channelId,
    partial: true,
    fetch: mock(async () => full),
  } as unknown as Published;
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
  const capture = new SushiiUpdatesCaptureService(
    { get: mock() } as never,
    SOURCE,
    { savePost },
    { recordPostCaptured } as unknown as SushiiUpdatesMetrics,
    pino({ level: "silent" }),
  );
  return {
    handler: new UpdatesPublishHandler(SOURCE, capture),
    stored,
    recordPostCaptured,
  };
}

describe("UpdatesPublishHandler", () => {
  test("an update without the Crossposted flag is ignored", async () => {
    const t = setup();
    const m = message();

    await t.handler.handle(m, m);

    expect(t.stored.size).toBe(0);
  });

  test("a published post is captured once even if the update repeats", async () => {
    const t = setup();
    const m = message({ flags: MessageFlags.Crossposted });

    await t.handler.handle(m, m);
    await t.handler.handle(m, m);

    expect(t.stored.size).toBe(1);
    expect(t.recordPostCaptured).toHaveBeenCalledTimes(1);
  });

  test("a partial update is fetched before checking the flag", async () => {
    const t = setup();
    const m = message({ flags: MessageFlags.Crossposted, partial: true });

    await t.handler.handle(m, m);

    expect(t.stored.size).toBe(1);
  });

  test("a partial update for a deleted message returns quietly", async () => {
    const t = setup();
    const m = {
      id: "900000000000000001",
      channelId: SOURCE,
      partial: true,
      fetch: mock(async () => {
        throw new DiscordAPIError(
          {
            code: RESTJSONErrorCodes.UnknownMessage,
            message: "Unknown Message",
          },
          RESTJSONErrorCodes.UnknownMessage,
          404,
          "GET",
          "/channels",
          {},
        );
      }),
    } as unknown as Published;

    await t.handler.handle(m, m);

    expect(t.stored.size).toBe(0);
  });

  test("an edit of an old published post is ignored", async () => {
    const t = setup();
    const m = message({ flags: MessageFlags.Crossposted, ageMs: 25 * HOUR });

    await t.handler.handle(m, m);

    expect(t.stored.size).toBe(0);
  });

  test("other channels are ignored", async () => {
    const t = setup();
    const m = message({
      flags: MessageFlags.Crossposted,
      channelId: "300000000000000002",
    });

    await t.handler.handle(m, m);

    expect(t.stored.size).toBe(0);
  });
});
