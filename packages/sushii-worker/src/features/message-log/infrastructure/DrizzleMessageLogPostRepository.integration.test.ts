import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { APIEmbed, Client } from "discord.js";
import pino from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import {
  messageLogPostsInAppPublic,
  messagesInAppPublic,
} from "@/infrastructure/database/schema";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { MessageDeleteAuditLogCache } from "../application/MessageDeleteAuditLogCache";
import { MessageLogService } from "../application/MessageLogService";
import { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageLogBlockRepository } from "../domain/repositories/MessageLogBlockRepository";
import { DrizzleMessageLogEventRepository } from "./DrizzleMessageLogEventRepository";
import { DrizzleMessageLogPostRepository } from "./DrizzleMessageLogPostRepository";

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const CHANNEL = "300000000000000001";
const LOG_CHANNEL = "300000000000000009";
const AUTHOR = "200000000000000001";

function messageId(i: number): string {
  return (500000000000000000n + BigInt(i)).toString();
}

function memberEvent(i: number, content: string): MessageLogEvent {
  const id = messageId(i);
  return new MessageLogEvent(
    id,
    AUTHOR,
    CHANNEL,
    GUILD,
    content,
    new Date(Date.UTC(2026, 2, 10, 12, 0, i)),
    {
      id,
      channel_id: CHANNEL,
      type: 0,
      author: {
        id: AUTHOR,
        username: "member",
        discriminator: "0",
        avatar: null,
        bot: false,
        global_name: null,
      },
      content,
      timestamp: "2026-03-10T12:00:00.000Z",
    },
  );
}

describe("DrizzleMessageLogPostRepository", () => {
  const testDb = new PostgresTestDatabase();
  let db: Awaited<ReturnType<PostgresTestDatabase["initialize"]>>;
  let postRepo: DrizzleMessageLogPostRepository;
  let eventRepo: DrizzleMessageLogEventRepository;

  beforeAll(async () => {
    db = await testDb.initialize();
    postRepo = new DrizzleMessageLogPostRepository(db);
    eventRepo = new DrizzleMessageLogEventRepository(
      db,
      pino({ level: "silent" }),
    );
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(messageLogPostsInAppPublic);
    await db.delete(messagesInAppPublic);
  });

  const row = (i: number, logMessageId: string) => ({
    messageId: messageId(i),
    guildId: GUILD,
    channelId: CHANNEL,
    logChannelId: LOG_CHANNEL,
    logMessageId,
  });

  test("saveMany upserts and the later post wins, even within one call", async () => {
    await postRepo.saveMany([row(1, "700000000000000001")]);
    await postRepo.saveMany([
      row(1, "700000000000000002"),
      row(2, "700000000000000002"),
      row(2, "700000000000000003"),
    ]);

    const found = await postRepo.findByMessageIds(GUILD, [
      messageId(1),
      messageId(2),
    ]);

    expect(
      found
        .map((r) => [r.messageId, r.logMessageId])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ).toEqual([
      [messageId(1), "700000000000000002"],
      [messageId(2), "700000000000000003"],
    ]);
  });

  test("saveMany with no rows does nothing", async () => {
    await postRepo.saveMany([]);

    expect(await db.select().from(messageLogPostsInAppPublic)).toEqual([]);
  });

  test("findByMessageIds only returns rows for the guild", async () => {
    await postRepo.saveMany([
      row(1, "700000000000000001"),
      { ...row(2, "700000000000000001"), guildId: OTHER_GUILD },
    ]);

    const found = await postRepo.findByMessageIds(GUILD, [
      messageId(1),
      messageId(2),
    ]);

    expect(found.map((r) => r.messageId)).toEqual([messageId(1)]);
    expect(await postRepo.findByMessageIds(GUILD, [])).toEqual([]);
  });

  test("deleteBefore removes only rows older than the cutoff", async () => {
    await db.insert(messageLogPostsInAppPublic).values([
      {
        messageId: BigInt(messageId(1)),
        guildId: BigInt(GUILD),
        channelId: BigInt(CHANNEL),
        logChannelId: BigInt(LOG_CHANNEL),
        logMessageId: 700000000000000001n,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    await postRepo.saveMany([row(2, "700000000000000002")]);

    const deleted = await postRepo.deleteBefore(
      new Date("2026-02-01T00:00:00.000Z"),
    );

    expect(deleted).toBe(1);
    const remaining = await postRepo.findByMessageIds(GUILD, [
      messageId(1),
      messageId(2),
    ]);
    expect(remaining.map((r) => r.messageId)).toEqual([messageId(2)]);
  });

  describe("MessageLogService delete logs", () => {
    function buildService(sendImpl?: () => Promise<never>) {
      const config = GuildConfig.createDefault(GUILD);
      config.loggingSettings.messageLogEnabled = true;
      config.loggingSettings.messageLogChannel = LOG_CHANNEL;

      const sent: { id: string; embeds: APIEmbed[] }[] = [];
      const send = mock(async (opts: { embeds: APIEmbed[] }) => {
        if (sendImpl) {
          return sendImpl();
        }
        const id = (700000000000000000n + BigInt(sent.length + 1)).toString();
        sent.push({ id, embeds: opts.embeds });
        return { id };
      });

      const client = {
        channels: {
          cache: { get: () => ({ isSendable: () => true, send }) },
        },
        rest: {
          cdn: {
            avatar: () => "https://cdn.example/avatar.png",
            defaultAvatar: () => "https://cdn.example/default.png",
            sticker: () => "https://cdn.example/sticker.png",
          },
        },
      } as unknown as Client;

      const service = new MessageLogService(
        client,
        eventRepo,
        {
          findByGuildAndChannel: async () => null,
        } as unknown as MessageLogBlockRepository,
        postRepo,
        {
          findByGuildId: async () => config,
        } as unknown as GuildConfigRepository,
        {
          getEmojis: async () => ({ message_delete: "🗑", message_edit: "✏" }),
        } as unknown as BotEmojiRepository,
        {
          waitForExecutor: async () => null,
        } as unknown as MessageDeleteAuditLogCache,
        pino({ level: "silent" }),
      );

      return { service, sent, send };
    }

    const marker = (i: number) => `[marker-${String(i).padStart(3, "0")}]`;

    test("bulk delete over several posts maps each message to the post that shows it", async () => {
      const count = 12;
      for (let i = 0; i < count; i++) {
        await eventRepo.save(
          memberEvent(i, `${marker(i)} ${"z".repeat(1500 + i * 50)}`),
        );
      }
      const { service, sent } = buildService();
      const ids = Array.from({ length: count }, (_, i) => messageId(i));

      await service.handleRawMessageDeleteBulk({
        ids,
        guild_id: GUILD,
        channel_id: CHANNEL,
      });

      expect(sent.length).toBeGreaterThanOrEqual(3);
      const rows = await postRepo.findByMessageIds(GUILD, ids);
      expect(rows.map((r) => r.messageId).sort()).toEqual([...ids].sort());

      for (const r of rows) {
        const i = ids.indexOf(r.messageId);
        const containing = sent.filter((post) =>
          post.embeds.some((e) => e.description?.includes(marker(i))),
        );
        expect(containing.map((p) => p.id)).toEqual([r.logMessageId]);
        expect(r.logChannelId).toBe(LOG_CHANNEL);
        expect(r.channelId).toBe(CHANNEL);
      }
    });

    test("single delete maps the message to its post", async () => {
      await eventRepo.save(memberEvent(1, "hello"));
      const { service, sent } = buildService();

      await service.handleRawMessageDelete({
        id: messageId(1),
        guild_id: GUILD,
        channel_id: CHANNEL,
      });

      const rows = await postRepo.findByMessageIds(GUILD, [messageId(1)]);
      expect(sent).toHaveLength(1);
      expect(rows.map((r) => r.logMessageId)).toEqual([sent[0].id]);
    });

    test("a failed send writes no mappings", async () => {
      await eventRepo.save(memberEvent(1, "hello"));
      await eventRepo.save(memberEvent(2, "world"));
      const { service, send } = buildService(async () => {
        throw new Error("Missing Access");
      });

      await service.handleRawMessageDelete({
        id: messageId(1),
        guild_id: GUILD,
        channel_id: CHANNEL,
      });
      await service.handleRawMessageDeleteBulk({
        ids: [messageId(1), messageId(2)],
        guild_id: GUILD,
        channel_id: CHANNEL,
      });

      expect(send).toHaveBeenCalledTimes(2);
      expect(await db.select().from(messageLogPostsInAppPublic)).toEqual([]);
    });
  });
});
