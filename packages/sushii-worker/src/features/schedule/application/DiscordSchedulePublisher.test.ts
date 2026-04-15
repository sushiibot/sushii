import { beforeEach, describe, expect, it, mock } from "bun:test";
import { ContainerBuilder } from "discord.js";
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

// ── Mock builders ──────────────────────────────────────────────────────────────

function makeRepo(existingMessages: ScheduleMessage[] = []): ScheduleMessageRepository {
  return {
    getMessages: mock(async () => existingMessages),
    upsertMessage: mock(async () => {}),
    deleteMessagesAboveIndex: mock(async () => {}),
    markArchived: mock(async () => {}),
    clearContentHashes: mock(async () => {}),
  };
}

function makeDiscordMessage(overrides: { edit?: () => Promise<unknown>; delete?: () => Promise<void> } = {}) {
  return {
    id: "12345",
    edit: mock(overrides.edit ?? (async () => {})),
    delete: mock(overrides.delete ?? (async () => {})),
  };
}

function makeDiscordChannel(opts: {
  fetchMessage?: () => Promise<unknown>;
  sendId?: string;
} = {}) {
  const channel = {
    isTextBased: () => true,
    isDMBased: () => false,
    messages: {
      fetch: mock(opts.fetchMessage ?? (async () => makeDiscordMessage())),
    },
    // Default to a valid snowflake-style numeric string
    send: mock(async () => ({ id: opts.sendId ?? "1234567890123456789" })),
  };
  return channel;
}

function makeClient(channel: ReturnType<typeof makeDiscordChannel> | null = null) {
  return {
    channels: {
      fetch: mock(async () => channel),
    },
  };
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
  discordChannel: ReturnType<typeof makeDiscordChannel> | null = null,
) {
  const client = makeClient(discordChannel);
  return {
    publisher: new DiscordSchedulePublisher(
      repo,
      client as never,
      logger,
      makeEmojiRepo(),
      makeMetrics() as never,
    ),
    client,
    discordChannel,
  };
}

// ── syncMessages tests ─────────────────────────────────────────────────────────

describe("DiscordSchedulePublisher.syncMessages", () => {
  describe("content hash unchanged", () => {
    it("does not edit the Discord message when hash matches", async () => {
      const discordMsg = makeDiscordMessage();
      const discordChannel = makeDiscordChannel({
        fetchMessage: async () => discordMsg,
      });
      const repo = makeRepo([makeStoredMessage(0, 10000n, "same-hash")]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("same-hash")]);

      expect(discordMsg.edit).not.toHaveBeenCalled();
    });

    it("does not call upsertMessage when hash matches", async () => {
      const discordChannel = makeDiscordChannel();
      const repo = makeRepo([makeStoredMessage(0, 10000n, "same-hash")]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("same-hash")]);

      expect(repo.upsertMessage).not.toHaveBeenCalled();
    });
  });

  describe("content hash changed", () => {
    it("edits the existing Discord message when hash differs", async () => {
      const discordMsg = makeDiscordMessage();
      const discordChannel = makeDiscordChannel({ fetchMessage: async () => discordMsg });
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(discordMsg.edit).toHaveBeenCalledTimes(1);
    });

    it("upserts the message record with the new hash after editing", async () => {
      const discordMsg = makeDiscordMessage();
      const discordChannel = makeDiscordChannel({ fetchMessage: async () => discordMsg });
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(repo.upsertMessage).toHaveBeenCalledWith(
        GUILD, CAL, CHANNEL_ID, 2024, 6, 0, 10000n, "new-hash",
      );
    });
  });

  describe("no existing message", () => {
    it("posts a new Discord message when none exists", async () => {
      const discordChannel = makeDiscordChannel({ sendId: "1111111111111111111" });
      const repo = makeRepo([]); // no existing messages
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash1")]);

      expect(discordChannel.send).toHaveBeenCalledTimes(1);
    });

    it("upserts a DB record with the new message ID", async () => {
      const discordChannel = makeDiscordChannel({ sendId: "9999999999999999999" });
      const repo = makeRepo([]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash1")]);

      expect(repo.upsertMessage).toHaveBeenCalledWith(
        GUILD, CAL, CHANNEL_ID, 2024, 6, 0, 9999999999999999999n, "hash1",
      );
    });
  });

  describe("deleted Discord message (error 10008 — Unknown Message)", () => {
    it("reposts as a new message when edit throws 10008", async () => {
      const discordMsg = makeDiscordMessage({
        edit: async () => { throw Object.assign(new Error("Unknown Message"), { code: 10008 }); },
      });
      const discordChannel = makeDiscordChannel({ fetchMessage: async () => discordMsg, sendId: "7777777777777777777" });
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(discordChannel.send).toHaveBeenCalledTimes(1);
    });

    it("updates the DB with the new message ID after repost", async () => {
      const discordMsg = makeDiscordMessage({
        edit: async () => { throw Object.assign(new Error("Unknown Message"), { code: 10008 }); },
      });
      const discordChannel = makeDiscordChannel({ fetchMessage: async () => discordMsg, sendId: "7777777777777777777" });
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]);

      expect(repo.upsertMessage).toHaveBeenCalledWith(
        GUILD, CAL, CHANNEL_ID, 2024, 6, 0, 7777777777777777777n, "new-hash",
      );
    });

    it("rethrows non-10008 errors from edit", async () => {
      const discordMsg = makeDiscordMessage({
        edit: async () => { throw Object.assign(new Error("Missing Access"), { code: 50013 }); },
      });
      const discordChannel = makeDiscordChannel({ fetchMessage: async () => discordMsg });
      const repo = makeRepo([makeStoredMessage(0, 10000n, "old-hash")]);
      const { publisher } = makePublisher(repo, discordChannel);

      await expect(
        publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("new-hash")]),
      ).rejects.toThrow("Missing Access");
    });
  });

  describe("excess chunks deleted", () => {
    it("deletes Discord messages for indices beyond the new chunk count", async () => {
      const excessMsg = makeDiscordMessage();
      const discordChannel = makeDiscordChannel({ fetchMessage: async () => excessMsg });
      // 2 messages exist, but now only 1 chunk
      const repo = makeRepo([
        makeStoredMessage(0, 10000n, "hash0"),
        makeStoredMessage(1, 20000n, "old-hash1"),
      ]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash0")]);

      expect(excessMsg.delete).toHaveBeenCalledTimes(1);
    });

    it("calls deleteMessagesAboveIndex with chunks.length - 1", async () => {
      const discordChannel = makeDiscordChannel();
      const repo = makeRepo([
        makeStoredMessage(0, 10000n, "hash0"),
        makeStoredMessage(1, 20000n, "hash1"),
        makeStoredMessage(2, 30000n, "hash2"),
      ]);
      const { publisher } = makePublisher(repo, discordChannel);

      // Shrink from 3 chunks to 1
      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash0")]);

      expect(repo.deleteMessagesAboveIndex).toHaveBeenCalledWith(GUILD, CAL, 2024, 6, 0);
    });

    it("does not call deleteMessagesAboveIndex when chunk count is unchanged", async () => {
      const discordChannel = makeDiscordChannel();
      const repo = makeRepo([makeStoredMessage(0, 10000n, "hash0")]);
      const { publisher } = makePublisher(repo, discordChannel);

      await publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash0")]);

      expect(repo.deleteMessagesAboveIndex).not.toHaveBeenCalled();
    });
  });

  describe("channel unavailable", () => {
    it("returns without error when Discord channel cannot be fetched", async () => {
      const repo = makeRepo([]);
      const { publisher } = makePublisher(repo, null); // client returns null

      // Should resolve without throwing
      await expect(
        publisher.syncMessages(makeSchedule(), 2024, 6, [makeChunk("hash1")]),
      ).resolves.toBeUndefined();

      expect(repo.upsertMessage).not.toHaveBeenCalled();
    });
  });
});

// ── archiveMonth tests ─────────────────────────────────────────────────────────

describe("DiscordSchedulePublisher.archiveMonth", () => {
  it("always calls markArchived even if Discord channel is unavailable", async () => {
    const repo = makeRepo([]);
    const { publisher } = makePublisher(repo, null);

    await publisher.archiveMonth(makeSchedule(), 2024, 5, [], [makeChunk("archive-hash")]);

    expect(repo.markArchived).toHaveBeenCalledWith(GUILD, CAL, 2024, 5);
  });

  it("marks messages as archived after successful edit", async () => {
    const discordMsg = makeDiscordMessage();
    const discordChannel = makeDiscordChannel({ fetchMessage: async () => discordMsg });
    const unarchivedMessages = [makeStoredMessage(0, 10000n, "old-hash")];
    const repo = makeRepo(unarchivedMessages);
    const { publisher } = makePublisher(repo, discordChannel);

    await publisher.archiveMonth(makeSchedule(), 2024, 5, unarchivedMessages, [makeChunk("archive-hash")]);

    expect(discordMsg.edit).toHaveBeenCalledTimes(1);
    expect(repo.markArchived).toHaveBeenCalledWith(GUILD, CAL, 2024, 5);
  });
});

// ── sendPermanentErrorAlert tests ─────────────────────────────────────────────

describe("DiscordSchedulePublisher.sendPermanentErrorAlert", () => {
  it("sends the alert when lastErrorAt is null (first failure)", async () => {
    const discordChannel = makeDiscordChannel();
    const repo = makeRepo([]);
    const { publisher } = makePublisher(repo, discordChannel);
    const schedule = makeSchedule({ lastErrorAt: null });

    await publisher.sendPermanentErrorAlert(schedule, 403, "Forbidden");

    expect(discordChannel.send).toHaveBeenCalledTimes(1);
  });

  it("does not send when lastErrorAt is within the past 24 hours", async () => {
    const discordChannel = makeDiscordChannel();
    const repo = makeRepo([]);
    const { publisher } = makePublisher(repo, discordChannel);
    const recentError = new Date(Date.now() - 60_000); // 1 minute ago
    const schedule = makeSchedule({ lastErrorAt: recentError });

    await publisher.sendPermanentErrorAlert(schedule, 403, "Forbidden");

    expect(discordChannel.send).not.toHaveBeenCalled();
  });

  it("sends again when lastErrorAt is older than 24 hours", async () => {
    const discordChannel = makeDiscordChannel();
    const repo = makeRepo([]);
    const { publisher } = makePublisher(repo, discordChannel);
    const oldError = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
    const schedule = makeSchedule({ lastErrorAt: oldError });

    await publisher.sendPermanentErrorAlert(schedule, 403, "Forbidden");

    expect(discordChannel.send).toHaveBeenCalledTimes(1);
  });

  it("includes 'permission' in the 403 alert message content", async () => {
    const discordChannel = makeDiscordChannel();
    const repo = makeRepo([]);
    const { publisher } = makePublisher(repo, discordChannel);

    await publisher.sendPermanentErrorAlert(makeSchedule({ lastErrorAt: null }), 403, "Forbidden");

    const sendCall = (discordChannel.send as ReturnType<typeof mock>).mock.calls[0][0];
    // The container component has the message text embedded in it; serialize to check
    const serialized = JSON.stringify(sendCall);
    expect(serialized).toContain("permission");
  });

  it("includes 'not found' in the 404 alert message content", async () => {
    const discordChannel = makeDiscordChannel();
    const repo = makeRepo([]);
    const { publisher } = makePublisher(repo, discordChannel);

    await publisher.sendPermanentErrorAlert(makeSchedule({ lastErrorAt: null }), 404, "Not Found");

    const sendCall = (discordChannel.send as ReturnType<typeof mock>).mock.calls[0][0];
    const serialized = JSON.stringify(sendCall);
    expect(serialized).toContain("404");
  });
});
