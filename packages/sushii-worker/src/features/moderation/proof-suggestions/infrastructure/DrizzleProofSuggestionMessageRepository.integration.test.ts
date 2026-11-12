import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import pino from "pino";

import type { MessageData } from "@/features/message-log/domain/types/MessageData";
import { DrizzleMessageLogBlockRepository } from "@/features/message-log/infrastructure/DrizzleMessageLogBlockRepository";
import { DrizzleMessageLogPostRepository } from "@/features/message-log/infrastructure/DrizzleMessageLogPostRepository";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  messageLogPostsInAppPublic,
  messagesInAppPublic,
  msgLogBlocksInAppPublic,
} from "@/infrastructure/database/schema";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { ProofSuggestionService } from "../application/ProofSuggestionService";
import type { ViewerAccess } from "../application/viewerAccess";
import { DrizzleProofSuggestionMessageRepository } from "./DrizzleProofSuggestionMessageRepository";

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const GENERAL = "300000000000000001";
const MEMES = "300000000000000002";
const SECRET = "300000000000000003";
const ALERTS = "300000000000000004";
const LOG = "300000000000000009";
const TARGET = "200000000000000001";
const BYSTANDER = "200000000000000002";
const APP = "200000000000000099";

const ACTION_TIME = new Date(Date.UTC(2026, 10, 10, 18, 30));

let seq = 0;
function nextId(): string {
  seq += 1;
  return (500000000000000000n + BigInt(seq)).toString();
}

function minutesBefore(minutes: number): Date {
  return new Date(ACTION_TIME.getTime() - minutes * 60_000);
}

interface Insert {
  channelId?: string;
  authorId?: string;
  type?: number;
  at: Date;
  content?: string;
  interactionUserId?: string;
  bot?: boolean;
  embeds?: MessageData["embeds"];
  guildId?: string;
}

describe("ProofSuggestionService.find (Postgres)", () => {
  const testDb = new PostgresTestDatabase();
  let db: Awaited<ReturnType<PostgresTestDatabase["initialize"]>>;
  let service: ProofSuggestionService;
  let postRepo: DrizzleMessageLogPostRepository;

  beforeAll(async () => {
    db = await testDb.initialize();
    const logger = pino({ level: "silent" });
    postRepo = new DrizzleMessageLogPostRepository(db);
    service = new ProofSuggestionService({
      messages: new DrizzleProofSuggestionMessageRepository(db),
      logPosts: postRepo,
      logBlocks: new DrizzleMessageLogBlockRepository(db, logger),
      guildConfigs: {
        findByGuildId: async (guildId) => {
          const config = GuildConfig.createDefault(guildId);
          config.loggingSettings.messageLogEnabled = true;
          config.loggingSettings.messageLogChannel = LOG;
          return config;
        },
        save: async (config) => config,
      },
      existence: {
        checkMany: async (_channelId, ids) =>
          new Map(ids.map((i) => [i, "exists" as const])),
      },
      logger,
    });
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(messagesInAppPublic);
    await db.delete(messageLogPostsInAppPublic);
    await db.delete(msgLogBlocksInAppPublic);
  });

  async function insert(rows: Insert[]): Promise<string[]> {
    const values = rows.map((r) => {
      const id = nextId();
      const authorId = r.authorId ?? TARGET;
      const channelId = r.channelId ?? GENERAL;
      const msg: MessageData = {
        id,
        channel_id: channelId,
        type: r.type ?? 0,
        author: {
          id: authorId,
          username: `u${authorId.slice(-2)}`,
          discriminator: "0",
          avatar: null,
          bot: r.bot ?? false,
          global_name: null,
        },
        content: r.content ?? `msg ${id}`,
        timestamp: r.at.toISOString(),
        embeds: r.embeds,
      };
      return {
        messageId: BigInt(id),
        guildId: BigInt(r.guildId ?? GUILD),
        channelId: BigInt(channelId),
        authorId: BigInt(authorId),
        created: r.at.toISOString(),
        content: msg.content,
        msg,
        interactionUserId: r.interactionUserId
          ? BigInt(r.interactionUserId)
          : null,
      };
    });

    // Chunked: one statement can't bind thousands of parameters comfortably.
    for (let i = 0; i < values.length; i += 100) {
      await db.insert(messagesInAppPublic).values(values.slice(i, i + 100));
    }

    return values.map((v) => v.messageId.toString());
  }

  async function logged(
    messageIds: string[],
    logMessageId = "900000000000000001",
  ) {
    await postRepo.saveMany(
      messageIds.map((messageId) => ({
        messageId,
        guildId: GUILD,
        channelId: GENERAL,
        logChannelId: LOG,
        logMessageId,
      })),
    );
  }

  const everything: ViewerAccess = {
    prepare: async () => undefined,
    canView: () => true,
    canRead: () => true,
    channelName: () => "general",
  };

  function find(access: ViewerAccess = everything) {
    return service.findWithAccess(
      { guildId: GUILD, targetId: TARGET, actionTime: ACTION_TIME },
      access,
    );
  }

  test("window: last 10 messages within 24 h before the action, newest first", async () => {
    await insert([
      { at: minutesBefore(25 * 60) }, // too old
      { at: new Date(ACTION_TIME.getTime() + 60_000) }, // after the action
      { at: minutesBefore(5), guildId: OTHER_GUILD },
      { at: minutesBefore(5), authorId: BYSTANDER },
      { at: minutesBefore(5), type: 7 }, // member join
    ]);
    const inWindow = await insert(
      Array.from({ length: 12 }, (_, i) => ({ at: minutesBefore(60 - i) })),
    );

    const suggestions = await find();

    expect(suggestions).toHaveLength(1);
    const [s] = suggestions;
    expect(s.kind).toBe("recent");
    expect(s.messageIds).toEqual(inWindow.slice(2));
    expect(s.totalInWindow).toBe(12);
    expect(s.firstAt).toEqual(minutesBefore(58));
    expect(s.lastAt).toEqual(minutesBefore(49));
    expect(s.deletedCount).toBe(0);
  });

  test("groups per channel and caps the total across channels at 10 messages", async () => {
    await insert(
      Array.from({ length: 6 }, (_, i) => ({ at: minutesBefore(30 - i) })),
    );
    await insert(
      Array.from({ length: 6 }, (_, i) => ({
        at: minutesBefore(20 - i),
        channelId: MEMES,
      })),
    );

    const suggestions = await find();

    expect(
      suggestions.map((s) => [
        s.channelId,
        s.messageIds.length,
        s.totalInWindow,
      ]),
    ).toEqual([
      [MEMES, 6, 6],
      [GENERAL, 4, 6],
    ]);
  });

  test("type 24 rows become automod suggestions and never count as messages", async () => {
    const [message] = await insert([{ at: minutesBefore(10), content: "hi" }]);
    const alertIds = await insert(
      Array.from({ length: 4 }, (_, i) => ({
        at: minutesBefore(5 - i),
        channelId: ALERTS,
        type: 24,
        content: "",
        embeds: [
          {
            description: `bad words ${i}`,
            fields: [
              { name: "rule_name", value: `Rule ${i}` },
              { name: "channel_id", value: GENERAL },
            ],
          },
        ],
      })),
    );
    await insert([
      {
        at: minutesBefore(1),
        channelId: ALERTS,
        type: 24,
        embeds: [{ description: "no rule field" }],
      },
    ]);

    const suggestions = await find();

    const automod = suggestions.filter((s) => s.kind === "automod");
    expect(automod.map((s) => s.messageIds[0])).toEqual([
      alertIds[3],
      alertIds[2],
      alertIds[1],
    ]);
    expect(automod[0]).toMatchObject({
      channelId: ALERTS,
      blockedInChannelId: GENERAL,
      ruleName: "Rule 3",
      snippet: "bad words 3",
      totalInWindow: 1,
    });

    const messages = suggestions.filter((s) => s.kind !== "automod");
    expect(messages).toHaveLength(1);
    expect(messages[0].messageIds).toEqual([message]);
    expect(messages[0].totalInWindow).toBe(1);
    expect(messages[0].snippet).toBe("hi");
  });

  test("deleted when every message is in message_log_posts, recent with a count otherwise", async () => {
    const general = await insert([
      { at: minutesBefore(10) },
      { at: minutesBefore(9) },
    ]);
    const memes = await insert([
      { at: minutesBefore(8), channelId: MEMES },
      { at: minutesBefore(7), channelId: MEMES },
    ]);
    await logged([...general, memes[0]]);

    const suggestions = await find();

    expect(
      suggestions.map((s) => [s.channelId, s.kind, s.deletedCount]),
    ).toEqual([
      [MEMES, "recent", 1],
      [GENERAL, "deleted", 2],
    ]);
  });

  test("app replies are attributed to the member who triggered them", async () => {
    const [reply] = await insert([
      {
        at: minutesBefore(3),
        authorId: APP,
        bot: true,
        type: 20,
        interactionUserId: TARGET,
      },
      {
        at: minutesBefore(2),
        authorId: APP,
        bot: true,
        type: 20,
        interactionUserId: BYSTANDER,
      },
    ]);

    const suggestions = await find();

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].messageIds).toEqual([reply]);
  });

  test("drops channels the viewer can't read and deleted items whose log channel they can't see", async () => {
    await insert([{ at: minutesBefore(10), channelId: SECRET }]);
    const general = await insert([
      { at: minutesBefore(9) },
      { at: minutesBefore(8) },
    ]);
    await logged([general[0]]);

    const suggestions = await find({
      ...everything,
      canRead: (c) => c !== SECRET,
      canView: (c) => c !== SECRET && c !== LOG,
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      channelId: GENERAL,
      kind: "recent",
      messageIds: [general[1]],
      deletedCount: 0,
      totalInWindow: 1,
    });
  });

  test("hidden deleted messages don't count or take slots; older live ones fill the cap", async () => {
    const older = await insert(
      Array.from({ length: 3 }, (_, i) => ({ at: minutesBefore(60 - i) })),
    );
    const purged = await insert(
      Array.from({ length: 10 }, (_, i) => ({ at: minutesBefore(10 - i) })),
    );
    await logged(purged);

    const suggestions = await find({
      ...everything,
      canView: (c) => c !== LOG,
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      kind: "recent",
      messageIds: older,
      totalInWindow: 3,
      deletedCount: 0,
    });

    const withLog = await find();
    expect(withLog[0]).toMatchObject({
      kind: "deleted",
      messageIds: purged,
      totalInWindow: 13,
    });
  });

  test("an unreadable channel doesn't use up the 10-message cap", async () => {
    await insert(
      Array.from({ length: 10 }, (_, i) => ({
        at: minutesBefore(10 - i),
        channelId: SECRET,
      })),
    );
    const general = await insert([{ at: minutesBefore(30) }]);

    const suggestions = await find({
      ...everything,
      canRead: (c) => c !== SECRET,
    });

    expect(suggestions.map((s) => s.messageIds)).toEqual([general]);
  });

  test("channels blocked from the message log now are skipped", async () => {
    await insert([{ at: minutesBefore(5), channelId: MEMES }]);
    const general = await insert([{ at: minutesBefore(6) }]);
    await db
      .insert(msgLogBlocksInAppPublic)
      .values({ guildId: BigInt(GUILD), channelId: BigInt(MEMES) });

    const suggestions = await find();

    expect(suggestions.map((s) => s.messageIds)).toEqual([general]);
  });

  test("AutoMod alerts need the alert channel", async () => {
    await insert([
      {
        at: minutesBefore(5),
        channelId: ALERTS,
        type: 24,
        embeds: [{ fields: [{ name: "rule_name", value: "Invites" }] }],
      },
    ]);

    expect(await find({ ...everything, canView: (c) => c !== ALERTS })).toEqual(
      [],
    );
    expect(await find()).toHaveLength(1);
  });

  test("a deleted AutoMod alert needs the message log channel", async () => {
    const alert = await insert([
      {
        at: minutesBefore(5),
        channelId: ALERTS,
        type: 24,
        embeds: [{ fields: [{ name: "rule_name", value: "Invites" }] }],
      },
    ]);
    await logged(alert);

    expect(await find({ ...everything, canView: (c) => c !== LOG })).toEqual(
      [],
    );
    expect(await find()).toHaveLength(1);
  });

  test("214-message spam: last 10 of 214, deleted via bulk log posts", async () => {
    const spam = await insert(
      Array.from({ length: 214 }, (_, i) => ({
        at: new Date(minutesBefore(15).getTime() + i * 2_000),
        content: "JOIN NOW discord.gg/spam",
      })),
    );
    await logged(spam.slice(0, 120), "900000000000000001");
    await logged(spam.slice(120), "900000000000000002");

    const suggestions = await find();

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      kind: "deleted",
      totalInWindow: 214,
      messageIds: spam.slice(-10),
      deletedCount: 10,
      snippet: "JOIN NOW discord.gg/spam",
    });

    const resolved = await service.resolveLinks(suggestions[0], {
      guildId: GUILD,
      actionKind: ActionType.Ban,
      actionTime: new Date(0),
    });
    expect(resolved.links).toHaveLength(1);
    expect(resolved.links[0].messageIds).toHaveLength(10);
  });
});
