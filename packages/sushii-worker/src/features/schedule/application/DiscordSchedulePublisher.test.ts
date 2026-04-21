import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ContainerBuilder, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import pino from "pino";

import type { Schedule } from "@/features/schedule/domain/entities/Schedule";
import type { ScheduleMessage } from "@/features/schedule/domain/entities/ScheduleMessage";
import type { ScheduleMessageRepository } from "@/features/schedule/domain/repositories/ScheduleMessageRepository";
import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { DiscordSchedulePublisher } from "./DiscordSchedulePublisher";

const logger = pino({ level: "silent" });

// ── Fixtures ───────────────────────────────────────────────────────────────────

const GUILD = 1n;
const CAL = "cal@group.calendar.google.com";
const CHANNEL_ID = 100n;
const LOG_CHANNEL_ID = 200n;
const USER_ID = 999n;

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  const now = new Date();
  return {
    guildId: GUILD,
    calendarId: CAL,
    channelId: CHANNEL_ID,
    logChannelId: LOG_CHANNEL_ID,
    configuredByUserId: USER_ID,
    calendarTitle: "My Calendar",
    displayTitle: "My Schedule",
    syncToken: null,
    pollIntervalSec: 120,
    nextPollAt: now,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorReason: null,
    accentColor: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeStoredMessage(index: number, messageId: bigint, hash: string, overrides: Partial<ScheduleMessage> = {}): ScheduleMessage {
  return {
    guildId: GUILD,
    calendarId: CAL,
    channelId: CHANNEL_ID,
    year: 2024,
    month: 6,
    messageIndex: index,
    messageId,
    contentHash: hash,
    isArchived: false,
    lastUpdatedAt: new Date(),
    ...overrides,
  };
}

/** Fake chunk that mimics renderSchedule() output */
function makeChunk(hash: string) {
  return { container: new ContainerBuilder(), hash };
}

/** Create a DiscordAPIError-shaped object that passes instanceof checks */
function makeDiscordAPIError(code: number, message: string): DiscordAPIError {
  const err = Object.create(DiscordAPIError.prototype) as DiscordAPIError;
  (err as unknown as { code: number }).code = code;
  err.message = message;
  return err;
}

// ── Mock builders ──────────────────────────────────────────────────────────────

function makeRepo(existingMessages: ScheduleMessage[] = []): ScheduleMessageRepository {
  return {
    getMessages: mock(async () => existingMessages),
    upsertMessage: mock(async () => {}),
    deleteMessagesAboveIndex: mock(async () => {}),
    markArchived: mock(async () => {}),
    clearContentHashes: mock(async () => {}),
    deleteAllMessages: mock(async () => {}),
  };
}

function makeRestClient(opts: {
  postResult?: { id: string };
  patchError?: Error;
  postError?: Error;
  deleteError?: Error;
} = {}) {
  return {
    post: mock(async () => {
      if (opts.postError) {
        throw opts.postError;
      }
      return opts.postResult ?? { id: "1234567890123456789" };
    }),
    patch: mock(async () => {
      if (opts.patchError) {
        throw opts.patchError;
      }
    }),
    delete: mock(async () => {
      if (opts.deleteError) {
        throw opts.deleteError;
      }
    }),
  };
}

function makeClient(restOpts: Parameters<typeof makeRestClient>[0] = {}) {
  return { rest: makeRestClient(restOpts) };
}

function makeEmojiRepo(): BotEmojiRepository {
  return {
    getEmojis: mock(async () => ({
      success: "✅",
      warning: "⚠️",
      trash: "🗑️",
      message_edit: "✏️",
    })),
  } as unknown as BotEmojiRepository;
}

function makeMetrics() {
  const counter = { add: mock(() => {}) };
  return {
    pollCounter: counter,
    messagesSyncedCounter: counter,
    eventsChangedCounter: counter,
  };
}

function makePublisher(
  repo: ScheduleMessageRepository,
  restOpts: Parameters<typeof makeRestClient>[0] = {},
) {
  const client = makeClient(restOpts);
  return {
    publisher: new DiscordSchedulePublisher(
      repo,
      client as never,
      logger,
      makeEmojiRepo(),
      makeMetrics() as never,
    ),
    client,
  };
}

// ── syncMessages tests ─────────────────────────────────────────────────────────

describe("DiscordSchedulePublisher.syncMessages", () => {
  describe("content hash unchanged", () => {
    it("does not call rest.patch when hash matches", async () => {
      const repo = makeRepo([makeStoredMessage(0, 10000n, "same-hash")]);
      const { publisher, client } = makePublisher(repo);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("same-hash")]);

      expect(client.rest.patch).not.toHaveBeenCalled();
    });

    it("does not call upsertMessage when hash matches", async () => {
      const repo = makeRepo([makeStoredMessage(0, 10000n, "same-hash")]);
      const { publisher } = makePublisher(repo);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("same-hash")]);

      expect(repo.upsertMessage).not.toHaveBeenCalled();
    });
  });

  describe("content hash changed", () => {
    it("patches the existing Discord message when hash differs", async () => {
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const { publisher, client } = makePublisher(repo);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(client.rest.patch).toHaveBeenCalledTimes(1);
    });

    it("upserts the message record with the new hash after patching", async () => {
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const { publisher } = makePublisher(repo);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(repo.upsertMessage).toHaveBeenCalledWith(
        GUILD, CAL, CHANNEL_ID, 2024, 6, 0, 10000n, "new-hash",
      );
    });
  });

  describe("no existing message", () => {
    it("posts a new Discord message when none exists", async () => {
      const repo = makeRepo([]);
      const { publisher, client } = makePublisher(repo, { postResult: { id: "1111111111111111111" } });

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash1")]);

      expect(client.rest.post).toHaveBeenCalledTimes(1);
    });

    it("upserts a DB record with the new message ID", async () => {
      const repo = makeRepo([]);
      const { publisher } = makePublisher(repo, { postResult: { id: "9999999999999999999" } });

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash1")]);

      expect(repo.upsertMessage).toHaveBeenCalledWith(
        GUILD, CAL, CHANNEL_ID, 2024, 6, 0, 9999999999999999999n, "hash1",
      );
    });
  });

  describe("deleted Discord message (error 10008 — Unknown Message)", () => {
    it("reposts as a new message when patch throws 10008", async () => {
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const patchError = makeDiscordAPIError(RESTJSONErrorCodes.UnknownMessage, "Unknown Message");
      const { publisher, client } = makePublisher(repo, {
        patchError,
        postResult: { id: "7777777777777777777" },
      });

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(client.rest.post).toHaveBeenCalledTimes(1);
    });

    it("updates the DB with the new message ID after repost", async () => {
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const patchError = makeDiscordAPIError(RESTJSONErrorCodes.UnknownMessage, "Unknown Message");
      const { publisher } = makePublisher(repo, {
        patchError,
        postResult: { id: "7777777777777777777" },
      });

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(repo.upsertMessage).toHaveBeenCalledWith(
        GUILD, CAL, CHANNEL_ID, 2024, 6, 0, 7777777777777777777n, "new-hash",
      );
    });

    it("returns false when patch throws a channel-inaccessible error (10003)", async () => {
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const patchError = makeDiscordAPIError(RESTJSONErrorCodes.UnknownChannel, "Unknown Channel");
      const { publisher } = makePublisher(repo, { patchError });

      const result = await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(result).toBe(false);
      expect(repo.upsertMessage).not.toHaveBeenCalled();
    });
  });

  describe("channel unavailable", () => {
    it("returns false when the channel cannot be posted to (10003)", async () => {
      const repo = makeRepo([]);
      const postError = makeDiscordAPIError(RESTJSONErrorCodes.UnknownChannel, "Unknown Channel");
      const { publisher } = makePublisher(repo, { postError });

      const result = await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash1")]);

      expect(result).toBe(false);
      expect(repo.upsertMessage).not.toHaveBeenCalled();
    });

    it("returns true on success", async () => {
      const repo = makeRepo([]);
      const { publisher } = makePublisher(repo);

      const result = await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash1")]);

      expect(result).toBe(true);
    });
  });

  describe("excess chunks deleted", () => {
    it("deletes Discord messages for indices beyond the new chunk count", async () => {
      // 2 messages exist, but now only 1 chunk (index 0 unchanged, index 1 excess)
      const repo = makeRepo([
        makeStoredMessage(0, 10000n, "hash0"),
        makeStoredMessage(1, 20000n, "old-hash1"),
      ]);
      const { publisher, client } = makePublisher(repo);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash0")]);

      expect(client.rest.delete).toHaveBeenCalledTimes(1);
    });

    it("calls deleteMessagesAboveIndex with chunks.length - 1", async () => {
      const repo = makeRepo([
        makeStoredMessage(0, 10000n, "hash0"),
        makeStoredMessage(1, 20000n, "hash1"),
        makeStoredMessage(2, 30000n, "hash2"),
      ]);
      const { publisher } = makePublisher(repo);

      // Shrink from 3 chunks to 1
      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash0")]);

      expect(repo.deleteMessagesAboveIndex).toHaveBeenCalledWith(GUILD, CAL, 2024, 6, 0);
    });

    it("does not call deleteMessagesAboveIndex when chunk count is unchanged", async () => {
      const repo = makeRepo([makeStoredMessage(0, 10000n, "hash0")]);
      const { publisher } = makePublisher(repo);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash0")]);

      expect(repo.deleteMessagesAboveIndex).not.toHaveBeenCalled();
    });
  });
});

// ── archiveMonth tests ─────────────────────────────────────────────────────────

describe("DiscordSchedulePublisher.archiveMonth", () => {
  it("always calls markArchived even if Discord channel is unavailable", async () => {
    const repo = makeRepo([]);
    const postError = makeDiscordAPIError(RESTJSONErrorCodes.UnknownChannel, "Unknown Channel");
    const { publisher } = makePublisher(repo, { postError });

    await publisher.archiveMonth(makeSchedule(), 2024, 5, [], [makeChunk("archive-hash")]);

    expect(repo.markArchived).toHaveBeenCalledWith(GUILD, CAL, 2024, 5);
  });

  it("marks messages as archived after successful edit", async () => {
    const unarchivedMessages = [makeStoredMessage(0, 10000n, "old-hash")];
    const repo = makeRepo(unarchivedMessages);
    const { publisher, client } = makePublisher(repo);

    await publisher.archiveMonth(makeSchedule(), 2024, 5, unarchivedMessages, [makeChunk("archive-hash")]);

    expect(client.rest.patch).toHaveBeenCalledTimes(1);
    expect(repo.markArchived).toHaveBeenCalledWith(GUILD, CAL, 2024, 5);
  });
});

// ── sendPermanentErrorAlert tests ─────────────────────────────────────────────

describe("DiscordSchedulePublisher.sendPermanentErrorAlert", () => {
  it("sends the alert when lastErrorAt is null (first failure)", async () => {
    const repo = makeRepo([]);
    const { publisher, client } = makePublisher(repo);
    const schedule = makeSchedule({ lastErrorAt: null });

    await publisher.sendPermanentErrorAlert(schedule, 403, "Forbidden");

    expect(client.rest.post).toHaveBeenCalledTimes(1);
  });

  it("does not send when lastErrorAt is within the past 24 hours", async () => {
    const repo = makeRepo([]);
    const { publisher, client } = makePublisher(repo);
    const recentError = new Date(Date.now() - 60_000); // 1 minute ago
    const schedule = makeSchedule({ lastErrorAt: recentError });

    await publisher.sendPermanentErrorAlert(schedule, 403, "Forbidden");

    expect(client.rest.post).not.toHaveBeenCalled();
  });

  it("sends again when lastErrorAt is older than 24 hours", async () => {
    const repo = makeRepo([]);
    const { publisher, client } = makePublisher(repo);
    const oldError = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    const schedule = makeSchedule({ lastErrorAt: oldError });

    await publisher.sendPermanentErrorAlert(schedule, 403, "Forbidden");

    expect(client.rest.post).toHaveBeenCalledTimes(1);
  });

  it("includes 'permission' in the 403 alert message content", async () => {
    const repo = makeRepo([]);
    const { publisher, client } = makePublisher(repo);

    await publisher.sendPermanentErrorAlert(makeSchedule({ lastErrorAt: null }), 403, "Forbidden");

    const [, callArgs] = (client.rest.post as ReturnType<typeof mock>).mock.calls[0] as [unknown, { body: unknown }];
    expect(JSON.stringify(callArgs.body)).toContain("permission");
  });

  it("includes '404' in the 404 alert message content", async () => {
    const repo = makeRepo([]);
    const { publisher, client } = makePublisher(repo);

    await publisher.sendPermanentErrorAlert(makeSchedule({ lastErrorAt: null }), 404, "Not Found");

    const [, callArgs] = (client.rest.post as ReturnType<typeof mock>).mock.calls[0] as [unknown, { body: unknown }];
    expect(JSON.stringify(callArgs.body)).toContain("404");
  });
});
