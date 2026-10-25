import { sleep } from "bun";
import { describe, expect, mock, test } from "bun:test";
import { ContainerBuilder } from "discord.js";
import pino from "pino";

import type {
  ImageVerdict,
  ScreeningClassifier,
  TextVerdict,
} from "../domain/ScreeningClassifier";
import type { ScreeningMetrics } from "../domain/ScreeningMetrics";
import type { ScreeningGuildRepository } from "../domain/repositories/ScreeningGuildRepository";
import type {
  CachedMessage,
  ScreeningMessageContextRepository,
} from "../domain/repositories/ScreeningMessageContextRepository";
import type { ScreeningVerdictRepository } from "../domain/repositories/ScreeningVerdictRepository";
import type {
  NewScreeningVerdict,
  ScreeningGuildSettings,
  ScreeningVerdict,
} from "../domain/types";
import {
  MemberScreeningService,
  type ScreenedMessage,
  judgedLines,
} from "./MemberScreeningService";
import type { ScreeningPostPublisher } from "./ScreeningPostPublisher";
import { ScreeningPostRenderer } from "./ScreeningPostRenderer";

const GUILD = "100000000000000001";
const USER = "200000000000000001";
const OTHER_USER = "200000000000000002";
const CHANNEL = "300000000000000001";
const LOG_CHANNEL = "300000000000000009";
const MOD = "400000000000000001";
const POST = "700000000000000001";
const NOW = new Date("2026-03-10T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

function settings(
  overrides: Partial<ScreeningGuildSettings> = {},
): ScreeningGuildSettings {
  return {
    guildId: GUILD,
    logChannelId: LOG_CHANNEL,
    maxMessages: 20,
    windowHours: 72,
    reviewThreshold: 0.7,
    rules: null,
    checkAvatars: false,
    dailyCheckCap: 2000,
    enabledBy: MOD,
    enabledAt: hoursAgo(1000),
    ...overrides,
  };
}

let nextMessageId = 500000000000000000n;

function message(overrides: Partial<ScreenedMessage> = {}): ScreenedMessage {
  nextMessageId += 1n;
  return {
    id: nextMessageId.toString(),
    guildId: GUILD,
    channelId: CHANNEL,
    content: "free nitro, claim before it expires",
    createdAt: NOW,
    embeds: [],
    author: { id: USER, avatar: null, name: "Newbie" },
    member: { joinedAt: hoursAgo(1), avatar: null },
    ...overrides,
  };
}

function textVerdict(score: number): TextVerdict {
  return { scores: { scam: score, hate: 0.01 }, model: "jev", cost: 0.001 };
}

function imageVerdict(unsafe: boolean): ImageVerdict {
  return {
    unsafe,
    categories: unsafe ? ["nudity"] : [],
    reason: unsafe ? "explicit" : "fine",
    model: "gemini",
    cost: 0.002,
  };
}

/** In-memory verdict store covering what the service reads back. */
function fakeVerdictRepo() {
  const rows: ScreeningVerdict[] = [];
  let nextId = 1;

  const toRow = (v: NewScreeningVerdict): ScreeningVerdict => ({
    id: nextId++,
    scores: null,
    categories: null,
    topRule: null,
    flagged: false,
    avatarHash: null,
    imageKey: null,
    sourceUrl: null,
    joinedAt: null,
    ordinal: null,
    model: null,
    cost: null,
    judged: null,
    error: null,
    postChannelId: null,
    postMessageId: null,
    outcome: null,
    outcomeBy: null,
    outcomeAction: null,
    ignoreReason: null,
    outcomeAt: null,
    messageDeleted: false,
    ...v,
  });

  const repo = {
    insert: mock(async (v: NewScreeningVerdict) => {
      const row = toRow(v);
      rows.push(row);
      return row;
    }),
    hasPfpVerdict: mock(async (userId: string, hash: string) =>
      rows.some((r) => r.userId === userId && r.avatarHash === hash),
    ),
    hasImageVerdict: mock(async (guildId: string, key: string) =>
      rows.some((r) => r.guildId === guildId && r.imageKey === key),
    ),
    countChecksToday: mock(async () => 0),
    findOpenTextPost: mock(
      async (guildId: string, userId: string, since: Date) => {
        const open = rows.filter(
          (r) =>
            r.guildId === guildId &&
            r.userId === userId &&
            r.kind === "text" &&
            r.flagged &&
            r.postMessageId !== null &&
            r.outcome === null &&
            r.createdAt >= since,
        );
        return open.at(-1) ?? null;
      },
    ),
    setPost: mock(async (id: number, channelId: string, messageId: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.postChannelId = channelId;
        row.postMessageId = messageId;
      }
    }),
    postedForUser: mock(async () => [] as ScreeningVerdict[]),
    setActioned: mock(async () => [] as ScreeningVerdict[]),
    hasCheckSince: mock(async (guildId: string, userId: string) =>
      rows.some(
        (r) =>
          r.guildId === guildId &&
          r.userId === userId &&
          ["text", "pfp", "image"].includes(r.kind),
      ),
    ),
    hasFlagSince: mock(async (guildId: string, userId: string) =>
      rows.some(
        (r) => r.guildId === guildId && r.userId === userId && r.flagged,
      ),
    ),
    hasMissSince: mock(async (guildId: string, userId: string) =>
      rows.some(
        (r) =>
          r.guildId === guildId && r.userId === userId && r.kind === "miss",
      ),
    ),
    markMessageDeleted: mock(async () => [] as ScreeningVerdict[]),
  };

  return { repo, rows };
}

function setup(
  opts: {
    settings?: ScreeningGuildSettings | null;
    priorMessages?: number;
    recent?: CachedMessage[];
  } = {},
) {
  const guildRepo = {
    findByGuildId: mock(async () =>
      opts.settings === undefined ? settings() : opts.settings,
    ),
  };
  const { repo: verdictRepo, rows } = fakeVerdictRepo();
  const contextRepo = {
    recentInChannel: mock(async () => opts.recent ?? []),
    countByAuthorSince: mock(async () => opts.priorMessages ?? 0),
  };
  const classifier = {
    classifyText: mock(async () => textVerdict(0.1)),
    classifyImage: mock(async () => imageVerdict(false)),
  };
  let postCount = 0;
  const publisher = {
    post: mock(async () => {
      postCount += 1;
      return (BigInt(POST) + BigInt(postCount - 1)).toString();
    }),
    edit: mock(
      async (
        _channelId: string,
        _messageId: string,
        _container: unknown,
      ): Promise<"edited" | "gone"> => "edited",
    ),
  };
  const renderer = Object.create(
    ScreeningPostRenderer.prototype,
  ) as ScreeningPostRenderer;
  renderer.render = mock(async () => new ContainerBuilder());
  renderer.renderPost = mock(async () => new ContainerBuilder());
  const metrics = {
    recordCheck: mock(() => undefined),
    recordOutcome: mock(() => undefined),
  };

  const service = new MemberScreeningService(
    guildRepo as unknown as ScreeningGuildRepository,
    verdictRepo as unknown as ScreeningVerdictRepository,
    contextRepo as unknown as ScreeningMessageContextRepository,
    classifier as unknown as ScreeningClassifier,
    publisher as unknown as ScreeningPostPublisher,
    renderer,
    metrics as unknown as ScreeningMetrics,
    pino({ level: "silent" }),
    () => NOW,
  );

  return {
    service,
    guildRepo,
    verdictRepo,
    rows,
    contextRepo,
    classifier,
    publisher,
    renderer,
    metrics,
  };
}

function posted(overrides: Partial<ScreeningVerdict> = {}): ScreeningVerdict {
  return {
    id: 99,
    guildId: GUILD,
    channelId: CHANNEL,
    userId: USER,
    messageId: "500000000000000099",
    kind: "text",
    scores: { scam: 0.9 },
    categories: null,
    topRule: "scam",
    flagged: true,
    avatarHash: null,
    imageKey: null,
    sourceUrl: null,
    joinedAt: hoursAgo(2),
    ordinal: 1,
    model: "jev",
    cost: 0.001,
    judged: null,
    error: null,
    postChannelId: LOG_CHANNEL,
    postMessageId: POST,
    outcome: null,
    outcomeBy: null,
    outcomeAction: null,
    ignoreReason: null,
    outcomeAt: null,
    messageDeleted: false,
    createdAt: hoursAgo(1),
    ...overrides,
  };
}

describe("MemberScreeningService.screenMessage", () => {
  test("skips guilds without settings", async () => {
    const t = setup({ settings: null });

    await t.service.screenMessage(message());

    expect(t.contextRepo.countByAuthorSince).not.toHaveBeenCalled();
    expect(t.classifier.classifyText).not.toHaveBeenCalled();
  });

  test("skips members who joined more than windowHours ago", async () => {
    const t = setup();

    await t.service.screenMessage(
      message({ member: { joinedAt: hoursAgo(73), avatar: null } }),
    );

    expect(t.classifier.classifyText).not.toHaveBeenCalled();
    expect(t.verdictRepo.insert).not.toHaveBeenCalled();
  });

  test("screens members still inside windowHours", async () => {
    const t = setup();

    await t.service.screenMessage(
      message({ member: { joinedAt: hoursAgo(71), avatar: null } }),
    );

    expect(t.classifier.classifyText).toHaveBeenCalledTimes(1);
  });

  test("stops after maxMessages since joining", async () => {
    const t = setup({ priorMessages: 20 });

    await t.service.screenMessage(message());

    expect(t.classifier.classifyText).not.toHaveBeenCalled();
  });

  test("records the ordinal of the last screened message", async () => {
    const t = setup({ priorMessages: 19 });
    const msg = message();

    await t.service.screenMessage(msg);

    expect(t.contextRepo.countByAuthorSince).toHaveBeenCalledWith(
      GUILD,
      USER,
      msg.member.joinedAt,
      msg.createdAt,
    );
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "text", ordinal: 20, flagged: false }),
    );
    expect(t.metrics.recordCheck).toHaveBeenCalledWith("text", "clean", 0.001);
  });

  test("skips trivial messages without a verdict", async () => {
    const t = setup();

    await t.service.screenMessage(message({ content: "😂😂 <@123456> !!" }));

    expect(t.classifier.classifyText).not.toHaveBeenCalled();
    expect(t.verdictRepo.insert).not.toHaveBeenCalled();
    expect(t.metrics.recordCheck).toHaveBeenCalledWith(
      "text",
      "skipped_trivial",
      null,
    );
  });

  test("skipText runs only the media checks", async () => {
    const t = setup();

    await t.service.screenMessage(message(), { skipText: true });

    expect(t.classifier.classifyText).not.toHaveBeenCalled();
    expect(t.metrics.recordCheck).not.toHaveBeenCalled();
  });

  test("skips checks past the daily cap", async () => {
    const t = setup({
      settings: settings({ dailyCheckCap: 5, checkAvatars: true }),
    });
    t.verdictRepo.countChecksToday.mockImplementation(async () => 5);

    await t.service.screenMessage(
      message({
        content: "look https://cdn.discordapp.com/attachments/1/2/a.png",
        author: { id: USER, avatar: "abc", name: "Newbie" },
      }),
    );

    expect(t.classifier.classifyText).not.toHaveBeenCalled();
    expect(t.classifier.classifyImage).not.toHaveBeenCalled();
    expect(t.verdictRepo.insert).not.toHaveBeenCalled();
    expect(t.metrics.recordCheck).toHaveBeenCalledWith(
      "text",
      "skipped_cap",
      null,
    );
    expect(t.metrics.recordCheck).toHaveBeenCalledWith(
      "pfp",
      "skipped_cap",
      null,
    );
    expect(t.metrics.recordCheck).toHaveBeenCalledWith(
      "image",
      "skipped_cap",
      null,
    );
  });

  test("sends earlier lines and the current message as context", async () => {
    const recent: CachedMessage[] = [
      {
        messageId: "500000000000000001",
        authorId: OTHER_USER,
        authorName: "Regular",
        content: "anyone selling tickets?",
        createdAt: hoursAgo(0.2),
      },
      {
        messageId: "500000000000000002",
        authorId: USER,
        authorName: "Newbie",
        content: "x".repeat(600),
        createdAt: hoursAgo(0.1),
      },
    ];
    const t = setup({ recent });
    t.classifier.classifyText.mockImplementation(async () => textVerdict(0.9));
    const msg = message({ content: "dm me" });

    await t.service.screenMessage(msg);

    expect(t.contextRepo.recentInChannel).toHaveBeenCalledWith(
      GUILD,
      CHANNEL,
      msg.createdAt,
      20,
    );
    expect(t.classifier.classifyText).toHaveBeenCalledWith(
      {
        new_message: { text: "dm me" },
        earlier_messages_from_same_member: ["x".repeat(500)],
      },
      expect.any(Array),
    );
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        flagged: true,
        topRule: "scam",
        judged: {
          context: [{ author: "Regular", text: "anyone selling tickets?" }],
          target: [
            { author: "Newbie", text: "x".repeat(600) },
            { author: "Newbie", text: "dm me" },
          ],
        },
      }),
    );
    expect(t.publisher.post).toHaveBeenCalledWith(
      LOG_CHANNEL,
      expect.any(ContainerBuilder),
    );
    expect(t.verdictRepo.setPost).toHaveBeenCalledWith(1, LOG_CHANNEL, POST);
  });

  test("records flags without posting when no log channel is set", async () => {
    const t = setup({ settings: settings({ logChannelId: null }) });
    t.classifier.classifyText.mockImplementation(async () => textVerdict(0.9));

    await t.service.screenMessage(message());

    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ flagged: true }),
    );
    expect(t.publisher.post).not.toHaveBeenCalled();
  });

  test("a burst of flagged messages edits one post", async () => {
    const t = setup();
    t.classifier.classifyText.mockImplementation(async () => textVerdict(0.9));

    await Promise.all([
      t.service.screenMessage(message()),
      t.service.screenMessage(message()),
    ]);
    await t.service.screenMessage(message());

    expect(t.publisher.post).toHaveBeenCalledTimes(1);
    expect(t.publisher.edit).toHaveBeenCalledTimes(2);
    expect(t.publisher.edit).toHaveBeenCalledWith(
      LOG_CHANNEL,
      POST,
      expect.any(ContainerBuilder),
    );
    expect(t.renderer.renderPost).toHaveBeenCalledWith(POST);
    expect(t.rows.map((r) => r.postMessageId)).toEqual([POST, POST, POST]);
  });

  test("a flag after the burst window gets its own post", async () => {
    const t = setup();
    t.classifier.classifyText.mockImplementation(async () => textVerdict(0.9));
    t.rows.push(posted({ id: 50, createdAt: hoursAgo(0.5) }));

    await t.service.screenMessage(message());

    expect(t.publisher.post).toHaveBeenCalledTimes(1);
    expect(t.publisher.edit).not.toHaveBeenCalled();
  });

  test("checks an avatar once, even for concurrent messages", async () => {
    const t = setup({ settings: settings({ checkAvatars: true }) });
    const member = { joinedAt: hoursAgo(1), avatar: "guildhash" };

    await Promise.all([
      t.service.screenMessage(message({ member }), { skipText: true }),
      t.service.screenMessage(message({ member }), { skipText: true }),
    ]);
    await t.service.screenMessage(message({ member }), { skipText: true });

    expect(t.classifier.classifyImage).toHaveBeenCalledTimes(1);
    expect(t.classifier.classifyImage).toHaveBeenCalledWith(
      `https://cdn.discordapp.com/guilds/${GUILD}/users/${USER}/avatars/guildhash.png?size=256`,
      "pfp",
    );
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "pfp", avatarHash: "guildhash" }),
    );
  });

  test("falls back to the user avatar and skips members without one", async () => {
    const t = setup({ settings: settings({ checkAvatars: true }) });

    await t.service.screenMessage(message(), { skipText: true });
    expect(t.classifier.classifyImage).not.toHaveBeenCalled();

    await t.service.screenMessage(
      message({ author: { id: USER, avatar: "userhash", name: "Newbie" } }),
      { skipText: true },
    );
    expect(t.classifier.classifyImage).toHaveBeenCalledWith(
      `https://cdn.discordapp.com/avatars/${USER}/userhash.png?size=256`,
      "pfp",
    );
  });

  test("posts unsafe images and dedupes them per guild", async () => {
    const t = setup();
    t.classifier.classifyImage.mockImplementation(async () =>
      imageVerdict(true),
    );
    const embeds = [
      {
        image: {
          proxy_url: "https://media.discordapp.net/attachments/1/2/a.png?ex=1",
        },
      },
    ];

    await t.service.screenMessage(message({ embeds }), { skipText: true });
    await t.service.screenMessage(message({ embeds }), { skipText: true });

    expect(t.classifier.classifyImage).toHaveBeenCalledTimes(1);
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "image",
        imageKey: "/attachments/1/2/a.png",
        flagged: true,
        categories: ["nudity"],
      }),
    );
    expect(t.publisher.post).toHaveBeenCalledTimes(1);
    expect(t.metrics.recordCheck).toHaveBeenCalledWith(
      "image",
      "flagged",
      0.002,
    );
  });

  test("stores an error verdict and never throws", async () => {
    const t = setup({ settings: settings({ checkAvatars: true }) });
    t.classifier.classifyText.mockImplementation(async () => {
      throw new Error("provider down");
    });
    t.classifier.classifyImage.mockImplementation(async () => {
      throw new Error("image unreachable");
    });

    await t.service.screenMessage(
      message({ author: { id: USER, avatar: "abc", name: "Newbie" } }),
    );

    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "text", error: "provider down" }),
    );
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "pfp", error: "image unreachable" }),
    );
    expect(t.metrics.recordCheck).toHaveBeenCalledWith("text", "error", null);
    expect(t.publisher.post).not.toHaveBeenCalled();
  });

  test("never throws when the settings lookup fails", async () => {
    const t = setup();
    t.guildRepo.findByGuildId.mockImplementation(async () => {
      throw new Error("db down");
    });

    await t.service.screenMessage(message());

    expect(t.classifier.classifyText).not.toHaveBeenCalled();
  });
});

describe("MemberScreeningService.recordAutomodBlock", () => {
  const block = {
    guildId: GUILD,
    userId: USER,
    channelId: CHANNEL,
    alertMessageId: null,
    ruleName: "Block slurs",
    content: "blocked words",
    joinedAt: hoursAgo(1),
  };

  test("scores the block silently and refreshes the member's posts", async () => {
    const t = setup();
    t.classifier.classifyText.mockImplementation(async () => textVerdict(0.95));
    t.verdictRepo.postedForUser.mockImplementation(async () => [posted()]);

    await t.service.recordAutomodBlock(block);

    expect(t.classifier.classifyText).toHaveBeenCalledWith(
      { new_message: { text: "blocked words" } },
      expect.any(Array),
    );
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "automod",
        messageId: "0",
        categories: ["Block slurs"],
        flagged: false,
        scores: { scam: 0.95, hate: 0.01 },
      }),
    );
    expect(t.verdictRepo.postedForUser).toHaveBeenCalledWith(
      GUILD,
      USER,
      block.joinedAt,
    );
    expect(t.publisher.post).not.toHaveBeenCalled();
    expect(t.publisher.edit).toHaveBeenCalledWith(
      LOG_CHANNEL,
      POST,
      expect.any(ContainerBuilder),
    );
  });

  test("ignores members outside the window", async () => {
    const t = setup();

    await t.service.recordAutomodBlock({ ...block, joinedAt: hoursAgo(80) });

    expect(t.classifier.classifyText).not.toHaveBeenCalled();
    expect(t.verdictRepo.insert).not.toHaveBeenCalled();
  });
});

describe("MemberScreeningService.recordModAction", () => {
  test("marks flags actioned and refreshes their posts", async () => {
    const t = setup();
    t.verdictRepo.setActioned.mockImplementation(async () => [
      posted({ outcome: "actioned" }),
    ]);

    await t.service.recordModAction(GUILD, USER, "banned", MOD);

    expect(t.verdictRepo.setActioned).toHaveBeenCalledWith(
      GUILD,
      USER,
      new Date(NOW.getTime() - 7 * 24 * HOUR_MS),
      MOD,
      "banned",
      NOW,
    );
    expect(t.renderer.renderPost).toHaveBeenCalledWith(POST);
    expect(t.publisher.edit).toHaveBeenCalledTimes(1);
    expect(t.metrics.recordOutcome).toHaveBeenCalledWith("actioned", {
      source: "audit_log",
    });
    expect(t.verdictRepo.insert).not.toHaveBeenCalled();
  });

  const cleanCheck = () =>
    posted({ flagged: false, postChannelId: null, postMessageId: null });

  test("records a miss for a screened member who was never flagged", async () => {
    const t = setup();
    t.rows.push(cleanCheck());

    await t.service.recordModAction(GUILD, USER, "kicked", null);

    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "miss",
        categories: ["kicked"],
        outcome: "actioned",
        outcomeBy: null,
        outcomeAction: "kicked",
      }),
    );
    expect(t.metrics.recordOutcome).toHaveBeenCalledWith("missed", {
      source: "audit_log",
    });
  });

  test("a timeout then a ban records one miss", async () => {
    const t = setup();
    t.rows.push(cleanCheck());

    await t.service.recordModAction(GUILD, USER, "timed out", MOD);
    await t.service.recordModAction(GUILD, USER, "banned", MOD);

    expect(t.verdictRepo.insert).toHaveBeenCalledTimes(1);
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "miss", outcomeAction: "timed out" }),
    );
    expect(t.metrics.recordOutcome).toHaveBeenCalledTimes(1);
  });

  test("an AutoMod-only member is not a miss", async () => {
    const t = setup();
    t.rows.push(cleanCheck());
    t.rows[0].kind = "automod";

    await t.service.recordModAction(GUILD, USER, "banned", MOD);

    expect(t.verdictRepo.insert).not.toHaveBeenCalled();
  });

  test("records nothing for an already-actioned flag", async () => {
    const t = setup();
    t.rows.push(posted({ outcome: "actioned" }));

    await t.service.recordModAction(GUILD, USER, "banned", MOD);

    expect(t.verdictRepo.insert).not.toHaveBeenCalled();
    expect(t.metrics.recordOutcome).not.toHaveBeenCalled();
  });

  test("records nothing for a member who was never screened", async () => {
    const t = setup();

    await t.service.recordModAction(GUILD, USER, "banned", MOD);

    expect(t.verdictRepo.insert).not.toHaveBeenCalled();
    expect(t.metrics.recordOutcome).not.toHaveBeenCalled();
  });
});

describe("MemberScreeningService.recordMessagesDeleted", () => {
  test("refreshes each affected post once", async () => {
    const t = setup();
    t.verdictRepo.markMessageDeleted.mockImplementation(async () => [
      posted({ messageDeleted: true }),
      posted({ id: 100, messageDeleted: true }),
    ]);

    await t.service.recordMessagesDeleted(["500000000000000099"]);

    expect(t.verdictRepo.markMessageDeleted).toHaveBeenCalledWith([
      "500000000000000099",
    ]);
    expect(t.publisher.edit).toHaveBeenCalledTimes(1);
    expect(t.publisher.edit).toHaveBeenCalledWith(
      LOG_CHANNEL,
      POST,
      expect.any(ContainerBuilder),
    );
  });

  test("a failed refresh is logged, not thrown", async () => {
    const t = setup();
    t.verdictRepo.markMessageDeleted.mockImplementation(async () => [posted()]);
    t.publisher.edit.mockImplementation(async () => {
      throw new Error("Unknown Message");
    });

    await t.service.recordMessagesDeleted(["500000000000000099"]);

    expect(t.publisher.edit).toHaveBeenCalledTimes(1);
  });
});

describe("judgedLines", () => {
  test("keeps the last five target lines and two context lines before them", () => {
    const line = (authorId: string, text: string): CachedMessage => ({
      messageId: text,
      authorId,
      authorName: authorId === USER ? "Newbie" : "Other",
      content: text,
      createdAt: NOW,
    });
    const rows = [
      line(OTHER_USER, "c1"),
      line(OTHER_USER, "c2"),
      line(OTHER_USER, "c3"),
      line(USER, "t1"),
      line(USER, "t2"),
      line(OTHER_USER, "c4"),
      line(USER, "t3"),
      line(USER, "t4"),
      line(USER, "t5"),
      line(USER, "t6"),
    ];

    const judged = judgedLines(rows, USER);

    expect(judged.target.map((l) => l.text)).toEqual([
      "t2",
      "t3",
      "t4",
      "t5",
      "t6",
    ]);
    expect(judged.context.map((l) => l.text)).toEqual(["c2", "c3"]);
  });
});

describe("MemberScreeningService review fixes", () => {
  test("a burst flag whose open post was deleted posts anew and later flags follow it", async () => {
    const t = setup();
    t.classifier.classifyText.mockImplementation(async () => textVerdict(0.9));
    t.rows.push(
      posted({ id: 50, createdAt: new Date(NOW.getTime() - 60_000) }),
    );
    t.publisher.edit.mockImplementation(
      async (_c: string, messageId: string) =>
        messageId === POST ? "gone" : "edited",
    );

    const NEW_POST = "700000000000000005";
    t.publisher.post.mockImplementation(async () => NEW_POST);

    await t.service.screenMessage(message());
    await t.service.screenMessage(message());

    expect(t.publisher.post).toHaveBeenCalledTimes(1);
    expect(t.rows.find((r) => r.id === 1)?.postMessageId).toBe(NEW_POST);
    expect(t.rows.find((r) => r.id === 2)?.postMessageId).toBe(NEW_POST);
    expect(t.publisher.edit).toHaveBeenLastCalledWith(
      LOG_CHANNEL,
      NEW_POST,
      expect.any(ContainerBuilder),
    );
  });

  test("refreshPosts isolates per-post failures", async () => {
    const t = setup();
    const OTHER_POST = "700000000000000002";
    t.publisher.edit.mockImplementationOnce(async () => {
      throw new Error("Missing Access");
    });

    await t.service.refreshPosts([
      posted(),
      posted({ id: 100 }),
      posted({ id: 101, postMessageId: OTHER_POST }),
    ]);

    expect(t.publisher.edit).toHaveBeenCalledTimes(2);
    expect(t.publisher.edit).toHaveBeenLastCalledWith(
      LOG_CHANNEL,
      OTHER_POST,
      expect.any(ContainerBuilder),
    );
  });

  test("an AutoMod block over the daily cap is recorded unscored", async () => {
    const t = setup({ settings: settings({ dailyCheckCap: 1 }) });
    t.verdictRepo.countChecksToday.mockImplementation(async () => 1);

    await t.service.recordAutomodBlock({
      guildId: GUILD,
      userId: USER,
      channelId: CHANNEL,
      alertMessageId: null,
      ruleName: "Block slurs",
      content: "blocked words",
      joinedAt: hoursAgo(1),
    });

    expect(t.classifier.classifyText).not.toHaveBeenCalled();
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "automod", scores: null }),
    );
    expect(t.metrics.recordCheck).toHaveBeenCalledWith(
      "automod",
      "skipped_cap",
      null,
    );
  });

  test("earlier lines from the member use their current name", async () => {
    const t = setup({
      recent: [
        {
          messageId: "500000000000000001",
          authorId: USER,
          authorName: "OldName",
          content: "first",
          createdAt: hoursAgo(0.1),
        },
      ],
    });
    t.classifier.classifyText.mockImplementation(async () => textVerdict(0.9));

    await t.service.screenMessage(message({ content: "second" }));

    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        judged: {
          context: [],
          target: [
            { author: "Newbie", text: "first" },
            { author: "Newbie", text: "second" },
          ],
        },
      }),
    );
  });

  test("a fifth classifier call waits for a free slot", async () => {
    const t = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.classifier.classifyText.mockImplementation(async () => {
      await gate;
      return textVerdict(0.1);
    });

    const runs = [1, 2, 3, 4, 5].map((n) =>
      t.service.screenMessage(
        message({
          author: { id: `20000000000000010${n}`, avatar: null, name: "N" },
        }),
      ),
    );
    await sleep(20);

    expect(t.classifier.classifyText).toHaveBeenCalledTimes(4);

    release();
    await Promise.all(runs);

    expect(t.classifier.classifyText).toHaveBeenCalledTimes(5);
  });

  test("a queued check re-checks the cap once it gets a slot", async () => {
    const t = setup({ settings: settings({ dailyCheckCap: 1 }) });
    t.verdictRepo.countChecksToday.mockImplementation(
      async () => t.rows.filter((r) => r.kind === "text").length,
    );
    const gates: (() => void)[] = [];
    t.classifier.classifyText.mockImplementation(async () => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return textVerdict(0.1);
    });

    const runs = [1, 2, 3, 4, 5].map((n) =>
      t.service.screenMessage(
        message({
          author: { id: `20000000000000020${n}`, avatar: null, name: "N" },
        }),
      ),
    );
    await sleep(20);
    expect(t.classifier.classifyText).toHaveBeenCalledTimes(4);

    // The first check's verdict lands inside its slot, so the queued fifth sees the cap reached.
    gates[0]();
    await sleep(20);

    expect(t.classifier.classifyText).toHaveBeenCalledTimes(4);
    expect(t.metrics.recordCheck).toHaveBeenCalledWith(
      "text",
      "skipped_cap",
      null,
    );

    for (const release of gates) {
      release();
    }
    await Promise.all(runs);
    expect(t.verdictRepo.insert).toHaveBeenCalledTimes(4);
  });

  test("an empty AutoMod block is stored without a cap check, score or metric", async () => {
    const t = setup();

    await t.service.recordAutomodBlock({
      guildId: GUILD,
      userId: USER,
      channelId: CHANNEL,
      alertMessageId: null,
      ruleName: "Block invites",
      content: "   ",
      joinedAt: hoursAgo(1),
    });

    expect(t.verdictRepo.countChecksToday).not.toHaveBeenCalled();
    expect(t.classifier.classifyText).not.toHaveBeenCalled();
    expect(t.metrics.recordCheck).not.toHaveBeenCalled();
    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "automod", scores: null }),
    );
  });

  test("a failed AutoMod scoring stores the error", async () => {
    const t = setup();
    t.classifier.classifyText.mockImplementation(async () => {
      throw new Error("provider down");
    });

    await t.service.recordAutomodBlock({
      guildId: GUILD,
      userId: USER,
      channelId: CHANNEL,
      alertMessageId: null,
      ruleName: "Block slurs",
      content: "blocked words",
      joinedAt: hoursAgo(1),
    });

    expect(t.verdictRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "automod", error: "provider down" }),
    );
    expect(t.metrics.recordCheck).toHaveBeenCalledWith(
      "automod",
      "error",
      null,
    );
  });
});
