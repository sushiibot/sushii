import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { MessageType } from "discord.js";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";

import { MessageLogEvent } from "@/features/message-log/domain/entities/MessageLogEvent";
import type { GuildMessageCreatePayload } from "@/features/message-log/domain/types/GuildMessagePayloads";
import { DrizzleMessageLogEventRepository } from "@/features/message-log/infrastructure/DrizzleMessageLogEventRepository";
import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { DrizzleScreeningMessageContextRepository } from "./DrizzleScreeningMessageContextRepository";

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const CHANNEL = "300000000000000001";
const OTHER_CHANNEL = "300000000000000002";
const USER = "200000000000000001";
const OTHER_USER = "200000000000000002";
const NOW = new Date("2026-03-10T12:00:00.000Z");

let nextMessageId = 500000000000000000n;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

interface SeedMessage {
  guildId?: string;
  channelId?: string;
  authorId?: string;
  content?: string;
  created: Date;
  author?: { username?: string; global_name?: string | null };
}

describe("DrizzleScreeningMessageContextRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleScreeningMessageContextRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleScreeningMessageContextRepository(db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(schema.messagesInAppPublic);
  });

  async function seed(m: SeedMessage): Promise<string> {
    nextMessageId += 1n;
    const authorId = m.authorId ?? USER;
    const msg = {
      id: nextMessageId.toString(),
      author: {
        id: authorId,
        username: m.author?.username ?? `user${authorId.slice(-1)}`,
        global_name: m.author?.global_name ?? null,
      },
    };
    await db.insert(schema.messagesInAppPublic).values({
      messageId: nextMessageId,
      guildId: BigInt(m.guildId ?? GUILD),
      channelId: BigInt(m.channelId ?? CHANNEL),
      authorId: BigInt(authorId),
      content: m.content ?? "hello",
      created: m.created.toISOString(),
      msg: sql`${JSON.stringify(msg)}`,
    });
    return nextMessageId.toString();
  }

  test("recentInChannel returns the newest messages before the bound, oldest first", async () => {
    const first = await seed({ created: minutesAgo(5), content: "one" });
    const second = await seed({ created: minutesAgo(4), content: "two" });
    const third = await seed({ created: minutesAgo(3), content: "three" });
    await seed({ created: minutesAgo(1), content: "after bound" });
    await seed({ created: minutesAgo(2), content: "at bound" });
    await seed({ created: minutesAgo(4), channelId: OTHER_CHANNEL });
    await seed({ created: minutesAgo(4), guildId: OTHER_GUILD });

    const rows = await repo.recentInChannel(GUILD, CHANNEL, minutesAgo(2), 2);

    expect(rows.map((r) => r.messageId)).toEqual([second, third]);
    expect(rows[1]).toEqual({
      messageId: third,
      authorId: USER,
      authorName: "user1",
      content: "three",
      createdAt: minutesAgo(3),
    });

    const all = await repo.recentInChannel(GUILD, CHANNEL, minutesAgo(2), 20);
    expect(all.map((r) => r.messageId)).toEqual([first, second, third]);
  });

  test("recentInChannel derives the author name from what the message cache writes", async () => {
    const writer = new DrizzleMessageLogEventRepository(
      db,
      pino({ level: "silent" }),
    );
    const write = async (
      created: Date,
      author: { id: string; username: string; global_name: string | null },
    ) => {
      nextMessageId += 1n;
      await writer.save(
        MessageLogEvent.fromRawMessageCreate({
          id: nextMessageId.toString(),
          guild_id: GUILD,
          channel_id: CHANNEL,
          author: { ...author, discriminator: "0", avatar: null },
          content: "hi",
          timestamp: created.toISOString(),
          // The writer never stores the member, so the nick step can't apply to cached rows.
          member: { nick: "Nick" },
        } as unknown as GuildMessageCreatePayload),
      );
    };
    await write(minutesAgo(3), {
      id: USER,
      username: "plain",
      global_name: "Global",
    });
    await write(minutesAgo(2), {
      id: USER,
      username: "plain",
      global_name: null,
    });
    nextMessageId += 1n;
    await db.insert(schema.messagesInAppPublic).values({
      messageId: nextMessageId,
      guildId: BigInt(GUILD),
      channelId: BigInt(CHANNEL),
      authorId: BigInt(OTHER_USER),
      content: "no author object",
      created: minutesAgo(1).toISOString(),
      msg: sql`${JSON.stringify({ id: nextMessageId.toString() })}`,
    });

    const rows = await repo.recentInChannel(GUILD, CHANNEL, NOW, 20);

    expect(rows.map((r) => r.authorName)).toEqual([
      "Global",
      "plain",
      OTHER_USER,
    ]);
    expect(rows[0].createdAt).toEqual(minutesAgo(3));
  });

  test("system messages are neither counted nor returned", async () => {
    const writer = new DrizzleMessageLogEventRepository(
      db,
      pino({ level: "silent" }),
    );
    const write = async (created: Date, type: MessageType) => {
      nextMessageId += 1n;
      await writer.save(
        MessageLogEvent.fromRawMessageCreate({
          id: nextMessageId.toString(),
          guild_id: GUILD,
          channel_id: CHANNEL,
          type,
          author: {
            id: USER,
            username: "plain",
            global_name: null,
            discriminator: "0",
            avatar: null,
          },
          content: type === MessageType.UserJoin ? "" : `type ${type}`,
          timestamp: created.toISOString(),
        } as unknown as GuildMessageCreatePayload),
      );
      return nextMessageId.toString();
    };
    const plain = await write(minutesAgo(5), MessageType.Default);
    await write(minutesAgo(4), MessageType.UserJoin);
    await write(minutesAgo(3), MessageType.AutoModerationAction);
    const reply = await write(minutesAgo(2), MessageType.Reply);
    const legacy = await seed({ created: minutesAgo(1) });

    const rows = await repo.recentInChannel(GUILD, CHANNEL, NOW, 20);

    expect(rows.map((r) => r.messageId)).toEqual([plain, reply, legacy]);
    expect(
      await repo.countByAuthorSince(GUILD, USER, minutesAgo(30), NOW),
    ).toBe(3);
  });

  test("countByAuthorSince counts the author's guild messages in [since, before)", async () => {
    await seed({ created: minutesAgo(10) });
    await seed({ created: minutesAgo(5) });
    await seed({ created: minutesAgo(5), channelId: OTHER_CHANNEL });
    await seed({ created: minutesAgo(3) });
    await seed({ created: minutesAgo(1) });
    await seed({ created: minutesAgo(4), authorId: OTHER_USER });
    await seed({ created: minutesAgo(4), guildId: OTHER_GUILD });

    expect(
      await repo.countByAuthorSince(GUILD, USER, minutesAgo(5), minutesAgo(1)),
    ).toBe(3);
    expect(
      await repo.countByAuthorSince(GUILD, USER, minutesAgo(30), NOW),
    ).toBe(5);
    expect(await repo.countByAuthorSince(GUILD, OTHER_USER, NOW, NOW)).toBe(0);
  });
});
