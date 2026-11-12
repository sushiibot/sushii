import { describe, expect, mock, test } from "bun:test";
import { PermissionFlagsBits, SnowflakeUtil } from "discord.js";
import type { GuildMember } from "discord.js";
import pino from "pino";

import { MessageLogBlock } from "@/features/message-log/domain/entities/MessageLogBlock";
import type { MessageLogBlockRepository } from "@/features/message-log/domain/repositories/MessageLogBlockRepository";
import type {
  MessageLogPost,
  MessageLogPostRepository,
} from "@/features/message-log/domain/repositories/MessageLogPostRepository";
import type { MessageData } from "@/features/message-log/domain/types/MessageData";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { ProofSuggestion } from "../domain/ProofSuggestion";
import type {
  CachedMessage,
  ProofSuggestionMessageRepository,
} from "../domain/ProofSuggestionMessageRepository";
import { messageUrl } from "../domain/proofContent";
import type {
  MessageExistence,
  MessageExistenceChecker,
} from "./MessageExistenceChecker";
import { ProofSuggestionService } from "./ProofSuggestionService";
import { viewerAccessFromMember } from "./viewerAccess";
import type { ViewerAccess } from "./viewerAccess";

const GUILD = "100000000000000001";
const CHANNEL = "300000000000000001";
const LOG = "300000000000000009";
const TARGET = "200000000000000001";
const BYSTANDER = "200000000000000002";
const APP = "200000000000000099";

function id(n: number): string {
  return (500000000000000000n + BigInt(n)).toString();
}

function post(messageId: string, logMessageId: string): MessageLogPost {
  return {
    messageId,
    guildId: GUILD,
    channelId: CHANNEL,
    logChannelId: LOG,
    logMessageId,
    createdAt: new Date(),
  };
}

function suggestion(messageIds: string[]): ProofSuggestion {
  return {
    kind: "recent",
    channelId: CHANNEL,
    messageIds,
    totalInWindow: messageIds.length,
    firstAt: new Date(0),
    lastAt: new Date(0),
    snippet: "",
  };
}

interface Harness {
  service: ProofSuggestionService;
  posts: Map<string, MessageLogPost>;
  checks: string[];
  checkCalls: [string, string[]][];
  postLookups: string[][];
  sleeps: number[];
  clock: { now: number };
}

function harness(opts: {
  existence?: Record<string, MessageExistence>;
  onSleep?: (h: Harness) => void;
  onCheck?: (h: Harness) => void;
  messages?: Partial<ProofSuggestionMessageRepository>;
  blockedChannels?: string[];
  messageLog?: boolean;
}): Harness {
  const h = {
    posts: new Map<string, MessageLogPost>(),
    checks: [] as string[],
    checkCalls: [] as [string, string[]][],
    postLookups: [] as string[][],
    sleeps: [] as number[],
    clock: { now: 1_000_000 },
  } as Harness;

  const logPosts: MessageLogPostRepository = {
    saveMany: mock(() => Promise.resolve()),
    deleteBefore: mock(async () => 0),
    findByMessageIds: async (_guildId, ids) => {
      h.postLookups.push(ids);
      return ids.flatMap((i) => {
        const p = h.posts.get(i);
        return p ? [p] : [];
      });
    },
  };

  const existence: MessageExistenceChecker = {
    checkMany: async (channelId, messageIds) => {
      h.checkCalls.push([channelId, messageIds]);
      h.checks.push(...messageIds);
      opts.onCheck?.(h);
      return new Map(
        messageIds.map((m) => [m, opts.existence?.[m] ?? "exists"]),
      );
    },
  };

  const logBlocks: MessageLogBlockRepository = {
    findByGuildId: async () => [],
    findByGuildAndChannel: async (_guildId, channelId) =>
      opts.blockedChannels?.includes(channelId)
        ? MessageLogBlock.create(GUILD, channelId)
        : null,
    addBlock: () => Promise.resolve(),
    removeBlock: () => Promise.resolve(),
  };

  const messages = {
    findTargetLogChannelIds: async () => [],
    countTargetMessagesByChannel: async () => new Map(),
    findLatestTargetMessages: async () => [],
    findTargetAutomodAlerts: async () => [],
    findByIds: async () => [],
    findOthersInChannel: async () => [],
    ...opts.messages,
  } as ProofSuggestionMessageRepository;

  const config = GuildConfig.createDefault(GUILD);
  config.loggingSettings.messageLogEnabled = opts.messageLog ?? true;
  config.loggingSettings.messageLogChannel = LOG;

  h.service = new ProofSuggestionService({
    messages,
    logPosts,
    logBlocks,
    guildConfigs: {
      findByGuildId: async () => config,
      save: async (c) => c,
    },
    existence,
    logger: pino({ level: "silent" }),
    now: () => h.clock.now,
    sleep: async (ms) => {
      h.sleeps.push(ms);
      h.clock.now += ms;
      opts.onSleep?.(h);
    },
  });

  return h;
}

describe("ProofSuggestionService.resolveLinks", () => {
  test("mapping rows win, then fetch: exists → link, 10008 → skipped, other error → skipped", async () => {
    const h = harness({
      existence: { [id(3)]: "unknown_message", [id(4)]: "error" },
    });
    h.posts.set(id(1), post(id(1), "900"));

    const result = await h.service.resolveLinks(
      suggestion([id(1), id(2), id(3), id(4)]),
      {
        guildId: GUILD,
        actionKind: ActionType.Warn,
        actionTime: new Date(h.clock.now),
      },
    );

    expect(h.checks).toEqual([id(2), id(3), id(4)]);
    expect(result.links.map((l) => [l.source, l.url])).toEqual([
      ["log", messageUrl(GUILD, LOG, "900")],
      ["message", messageUrl(GUILD, CHANNEL, id(2))],
    ]);
    expect(result.skipped).toEqual([
      { messageId: id(3), reason: "deleted_not_logged" },
      { messageId: id(4), reason: "unchecked" },
    ]);
    expect(result.pending).toEqual([]);
  });

  test("dedupes log links per post", async () => {
    const h = harness({});
    h.posts.set(id(1), post(id(1), "900"));
    h.posts.set(id(2), post(id(2), "900"));
    h.posts.set(id(3), post(id(3), "901"));

    const result = await h.service.resolveLinks(
      suggestion([id(1), id(2), id(3)]),
      {
        guildId: GUILD,
        actionKind: ActionType.Ban,
        actionTime: new Date(h.clock.now),
      },
    );

    expect(result.links).toHaveLength(2);
    expect(result.links[0].messageIds).toEqual([id(1), id(2)]);
    expect(h.checks).toEqual([]);
  });

  test("fresh native ban with an unknown window waits for the mapping, then checks the rest: live → link, 10008 → pending, error → unchecked", async () => {
    const h = harness({
      existence: { [id(3)]: "unknown_message", [id(4)]: "error" },
      onSleep: (state) => {
        if (state.sleeps.length === 2) {
          state.posts.set(id(1), post(id(1), "900"));
        }
      },
    });

    const result = await h.service.resolveLinks(
      suggestion([id(1), id(2), id(3), id(4)]),
      {
        guildId: GUILD,
        actionKind: ActionType.Ban,
        actionTime: new Date(h.clock.now - 2_000),
        purgeWindowUnknown: true,
      },
    );

    expect(result.links.map((l) => [l.source, l.messageIds])).toEqual([
      ["log", [id(1)]],
      ["message", [id(2)]],
    ]);
    expect(result.pending).toEqual([id(3)]);
    expect(result.skipped).toEqual([{ messageId: id(4), reason: "unchecked" }]);
    expect(h.checks).toEqual([id(2), id(3), id(4)]);
    expect(h.sleeps.every((ms) => ms === 250)).toBe(true);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBe(5_000);
  });

  test("a fresh ban that purged nothing doesn't wait; 10008 is then deleted, not pending", async () => {
    for (const purgeWindowSeconds of [undefined, null, 0]) {
      const h = harness({ existence: { [id(2)]: "unknown_message" } });

      const result = await h.service.resolveLinks(suggestion([id(1), id(2)]), {
        guildId: GUILD,
        actionKind: ActionType.Ban,
        actionTime: new Date(h.clock.now),
        purgeWindowSeconds,
      });

      expect(h.sleeps).toEqual([]);
      expect(result.links.map((l) => l.messageIds)).toEqual([[id(1)]]);
      expect(result.pending).toEqual([]);
      expect(result.skipped).toEqual([
        { messageId: id(2), reason: "deleted_not_logged" },
      ]);
    }
  });

  test("a fresh ban waits only for messages inside its purge window; older 10008s are deleted, not pending", async () => {
    const actionMs = Date.UTC(2026, 10, 11, 12, 0, 0);
    const at = (msBefore: number) =>
      SnowflakeUtil.generate({ timestamp: actionMs - msBefore }).toString();
    const edge = at(3_600_000);
    const inside = at(60_000);
    const outside = at(3_600_001);
    const h = harness({
      existence: {
        [edge]: "unknown_message",
        [inside]: "unknown_message",
        [outside]: "unknown_message",
      },
    });
    h.clock.now = actionMs + 1_000;

    const result = await h.service.resolveLinks(
      suggestion([outside, edge, inside]),
      {
        guildId: GUILD,
        actionKind: ActionType.TempBan,
        actionTime: new Date(actionMs),
        purgeWindowSeconds: 3_600,
      },
    );

    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBe(5_000);
    expect(h.postLookups[1]).toEqual([edge, inside]);
    expect(result.pending).toEqual([edge, inside]);
    expect(result.skipped).toEqual([
      { messageId: outside, reason: "deleted_not_logged" },
    ]);
  });

  test("with only messages outside the purge window there is nothing to wait for", async () => {
    const actionMs = Date.UTC(2026, 10, 11, 12, 0, 0);
    const old = SnowflakeUtil.generate({
      timestamp: actionMs - 120_000,
    }).toString();
    const h = harness({ existence: { [old]: "unknown_message" } });
    h.clock.now = actionMs;

    const result = await h.service.resolveLinks(suggestion([old]), {
      guildId: GUILD,
      actionKind: ActionType.Softban,
      actionTime: new Date(actionMs),
      purgeWindowSeconds: 60,
    });

    expect(h.sleeps).toEqual([]);
    expect(result.skipped).toEqual([
      { messageId: old, reason: "deleted_not_logged" },
    ]);
  });

  test("re-reads the mapping before reporting a message as deleted and not logged", async () => {
    const h = harness({
      existence: { [id(1)]: "unknown_message", [id(2)]: "unknown_message" },
      onCheck: (state) => {
        state.posts.set(id(1), post(id(1), "900"));
      },
    });

    const result = await h.service.resolveLinks(suggestion([id(1), id(2)]), {
      guildId: GUILD,
      actionKind: ActionType.Warn,
      actionTime: new Date(h.clock.now),
    });

    expect(result.links.map((l) => [l.source, l.messageIds])).toEqual([
      ["log", [id(1)]],
    ]);
    expect(result.skipped).toEqual([
      { messageId: id(2), reason: "deleted_not_logged" },
    ]);
  });

  test("fresh ban stops waiting once everything is mapped", async () => {
    const h = harness({
      onSleep: (state) => {
        state.posts.set(id(1), post(id(1), "900"));
      },
    });

    const result = await h.service.resolveLinks(suggestion([id(1)]), {
      guildId: GUILD,
      actionKind: ActionType.Softban,
      actionTime: new Date(h.clock.now),
      purgeWindowUnknown: true,
    });

    expect(h.sleeps).toEqual([250]);
    expect(result.pending).toEqual([]);
    expect(result.links).toHaveLength(1);
  });

  test("fresh ban doesn't wait on an AutoMod alert; it links the alert message", async () => {
    const h = harness({});
    const alert = {
      ...suggestion([id(1)]),
      kind: "automod" as const,
      channelId: "300000000000000004",
    };

    const result = await h.service.resolveLinks(alert, {
      guildId: GUILD,
      actionKind: ActionType.Ban,
      actionTime: new Date(h.clock.now),
      purgeWindowUnknown: true,
    });

    expect(h.sleeps).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(result.links).toEqual([
      {
        url: messageUrl(GUILD, "300000000000000004", id(1)),
        source: "message",
        channelId: "300000000000000004",
        messageIds: [id(1)],
      },
    ]);
  });

  test("old ban or non-purge action fetches instead of waiting", async () => {
    for (const [actionKind, age] of [
      [ActionType.Ban, 10_000],
      [ActionType.Timeout, 0],
    ] as const) {
      const h = harness({});
      const result = await h.service.resolveLinks(suggestion([id(1)]), {
        guildId: GUILD,
        actionKind,
        actionTime: new Date(h.clock.now - age),
      });

      expect(h.sleeps).toEqual([]);
      expect(h.checks).toEqual([id(1)]);
      expect(result.links[0].source).toBe("message");
    }
  });
});

describe("ProofSuggestionService.resolveLinksMany", () => {
  test("one existence check per channel and one shared wait across suggestions", async () => {
    const ALERTS = "300000000000000004";
    const h = harness({});
    const alertA = {
      ...suggestion([id(20)]),
      kind: "automod" as const,
      channelId: ALERTS,
    };
    const alertB = { ...alertA, messageIds: [id(21)] };
    const other = {
      ...suggestion([id(3), id(4)]),
      channelId: "300000000000000002",
    };

    const results = await h.service.resolveLinksMany(
      [suggestion([id(1), id(2)]), alertA, other, alertB],
      {
        guildId: GUILD,
        actionKind: ActionType.Ban,
        actionTime: new Date(h.clock.now),
        purgeWindowUnknown: true,
      },
    );

    expect(h.checkCalls).toEqual([
      [CHANNEL, [id(1), id(2)]],
      [ALERTS, [id(20), id(21)]],
      ["300000000000000002", [id(3), id(4)]],
    ]);
    expect(h.sleeps.reduce((a, b) => a + b, 0)).toBe(5_000);
    expect(results.map((r) => r.links.flatMap((l) => l.messageIds))).toEqual([
      [id(1), id(2)],
      [id(20)],
      [id(3), id(4)],
      [id(21)],
    ]);
  });
});

function row(
  n: number,
  authorId: string,
  overrides: Partial<Omit<CachedMessage, "msg">> & {
    msg?: Partial<MessageData>;
  } = {},
): CachedMessage {
  const createdAt =
    overrides.createdAt ?? new Date(Date.UTC(2026, 10, 10, 18, n));
  const { msg, ...rest } = overrides;
  return {
    id: id(n),
    channelId: CHANNEL,
    authorId,
    interactionUserId: null,
    createdAt,
    content: `m${n}`,
    ...rest,
    msg: {
      id: id(n),
      channel_id: CHANNEL,
      type: 0,
      author: {
        id: authorId,
        username: `user${authorId.slice(-2)}`,
        discriminator: "0",
        avatar: "userhash",
        bot: false,
        global_name: null,
      },
      content: `m${n}`,
      timestamp: createdAt.toISOString(),
      ...msg,
    },
  };
}

async function previewOf(
  service: ProofSuggestionService,
  ...args: Parameters<ProofSuggestionService["toPreviewRequestWithAccess"]>
) {
  const request = await service.toPreviewRequestWithAccess(...args);
  if (!request) {
    throw new Error("expected a preview");
  }

  return request;
}

const openAccess: ViewerAccess = {
  prepare: async () => undefined,
  canView: () => true,
  canRead: () => true,
  channelName: () => "general",
};

describe("ProofSuggestionService.toPreviewRequestWithAccess", () => {
  test("maps names, app replies, context and counts", async () => {
    const targetRows = [
      row(10, TARGET, {
        msg: {
          member: { nick: "Spammy", avatar: "memberhash" },
          attachments: [
            {
              id: "1",
              filename: "a.png",
              size: 1,
              url: "u",
              proxy_url: "p",
            },
          ],
        },
      }),
      row(12, APP, {
        interactionUserId: TARGET,
        msg: {
          type: 20,
          author: {
            id: APP,
            username: "PostIt",
            discriminator: "0",
            avatar: null,
            bot: true,
            global_name: null,
          },
        },
      }),
    ];
    const others = [
      row(5, BYSTANDER),
      row(7, BYSTANDER, {
        msg: {
          author: {
            id: BYSTANDER,
            username: "bob",
            discriminator: "0",
            avatar: null,
            bot: false,
            global_name: "Bobby",
          },
        },
      }),
      row(8, BYSTANDER),
      row(11, BYSTANDER),
    ];

    const findOthers = mock(async () => [...others].reverse());
    const h = harness({
      messages: {
        findByIds: async () => targetRows,
        findOthersInChannel: findOthers,
      },
    });
    h.posts.set(id(10), post(id(10), "900"));

    const request = await previewOf(
      h.service,
      { ...suggestion([id(10), id(12)]), totalInWindow: 214 },
      {
        guildId: GUILD,
        targetId: TARGET,
        actionTime: new Date("2026-11-10T18:22:00Z"),
        actionNoun: "ban",
      },
      openAccess,
    );

    expect(request.messages.map((m) => m.id)).toEqual([
      id(7),
      id(8),
      id(10),
      id(11),
      id(12),
    ]);
    const [, , spam, , appReply] = request.messages;
    expect(spam.author.displayName).toBe("Spammy");
    expect(spam.author.memberAvatarHash).toBe("memberhash");
    expect(spam.deleted).toBe(true);
    expect(spam.attachmentNames).toEqual(["a.png"]);
    expect(request.messages[0].author.displayName).toBe("Bobby");
    expect(appReply.author.isApp).toBe(true);
    expect(appReply.triggeredById).toBe(TARGET);
    expect(appReply.triggeredBy).toBe("Spammy");
    expect(appReply.deleted).toBe(false);
    expect(request.hiddenEarlierCount).toBe(212);
    expect(request.actionTime).toEqual(new Date("2026-11-10T18:22:00Z"));
    expect(request.actionNoun).toBe("ban");
    expect(request.subtitle).toBe(
      "12–10m before the ban · Spammy's last 2 of 214 messages",
    );
    expect(request.channelName).toBe("general");
    expect(request.targetUserId).toBe(TARGET);
  });

  test("drops deleted context messages when the viewer can't see the log channel", async () => {
    const h = harness({
      messages: {
        findByIds: async () => [row(10, TARGET)],
        findOthersInChannel: async () => [row(9, BYSTANDER), row(8, BYSTANDER)],
      },
    });
    h.posts.set(id(9), post(id(9), "900"));

    const request = await previewOf(
      h.service,
      suggestion([id(10)]),
      {
        guildId: GUILD,
        targetId: TARGET,
        targetDisplayName: "Target",
        actionTime: new Date("2026-11-10T18:22:00Z"),
        actionNoun: "timeout",
      },
      { ...openAccess, canView: (c) => c !== LOG },
    );

    expect(request.messages.map((m) => m.id)).toEqual([id(8), id(10)]);
    expect(request.subtitle).toBe(
      "12m before the timeout · Target's 1 message",
    );
    expect(request.hiddenEarlierCount).toBe(0);
  });

  test("automod preview shows the flagged content", async () => {
    const alert = row(20, TARGET, {
      content: "",
      msg: {
        type: 24,
        embeds: [
          {
            description: "buy followers",
            fields: [
              { name: "rule_name", value: "Spam" },
              { name: "channel_id", value: "300000000000000002" },
            ],
          },
        ],
      },
    });
    const h = harness({ messages: { findByIds: async () => [alert] } });

    const request = await previewOf(
      h.service,
      {
        ...suggestion([id(20)]),
        kind: "automod",
        ruleName: "Spam",
        blockedInChannelId: "300000000000000002",
        lastAt: alert.createdAt,
      },
      {
        guildId: GUILD,
        targetId: TARGET,
        actionTime: new Date("2026-11-10T18:22:00Z"),
        actionNoun: "ban",
      },
      {
        ...openAccess,
        channelName: (c) => (c === CHANNEL ? "alerts" : "chat"),
      },
    );

    expect(request.channelName).toBe("chat");
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].content).toBe("buy followers");
    expect(request.messages[0].automodFlagged).toBe(true);
    expect(request.subtitle).toBe("2m before the ban · AutoMod: Spam");
  });

  test("automod preview hides the blocked-in channel name the viewer can't see", async () => {
    const h = harness({ messages: { findByIds: async () => [] } });

    const request = await previewOf(
      h.service,
      {
        ...suggestion([id(20)]),
        kind: "automod",
        blockedInChannelId: "300000000000000002",
      },
      {
        guildId: GUILD,
        targetId: TARGET,
        actionTime: new Date("2026-11-10T18:22:00Z"),
        actionNoun: "ban",
      },
      {
        ...openAccess,
        canView: (c) => c !== "300000000000000002",
        channelName: (c) => (c === CHANNEL ? "alerts" : "secret"),
      },
    );

    expect(request.channelName).toBe("alerts");
  });

  test("ignores ids that aren't the target's messages in the suggestion's channel", async () => {
    const OTHER_CHANNEL = "300000000000000002";
    const rows = [
      row(10, TARGET),
      row(11, BYSTANDER),
      row(12, TARGET, { channelId: OTHER_CHANNEL }),
      row(13, APP, { interactionUserId: TARGET }),
      row(14, APP, { interactionUserId: BYSTANDER }),
    ];
    const findByIds = mock(async () => rows);
    const h = harness({ messages: { findByIds } });

    const request = await previewOf(
      h.service,
      suggestion(rows.map((r) => r.id)),
      {
        guildId: GUILD,
        targetId: TARGET,
        actionTime: new Date("2026-11-10T18:22:00Z"),
        actionNoun: "ban",
      },
      openAccess,
    );

    expect(request.messages.map((m) => m.id)).toEqual([id(10), id(13)]);

    const alertRows = [...rows, row(15, TARGET, { msg: { type: 24 } })];
    findByIds.mockImplementation(async () => alertRows);
    const alertRequest = await previewOf(
      h.service,
      { ...suggestion(alertRows.map((r) => r.id)), kind: "automod" },
      {
        guildId: GUILD,
        targetId: TARGET,
        actionTime: new Date("2026-11-10T18:22:00Z"),
        actionNoun: "ban",
      },
      openAccess,
    );

    // Only the target's own type-24 alert, never their ordinary messages.
    expect(alertRequest.messages.map((m) => m.id)).toEqual([id(15)]);
  });

  test("returns null when the viewer lost access", async () => {
    const targetRows = [row(10, TARGET)];
    const cases: {
      access: ViewerAccess;
      blockedChannels?: string[];
      deleted?: boolean;
    }[] = [
      { access: { ...openAccess, canRead: () => false } },
      { access: openAccess, blockedChannels: [CHANNEL] },
      {
        access: { ...openAccess, canView: (c) => c !== LOG },
        deleted: true,
      },
    ];

    for (const c of cases) {
      const h = harness({
        messages: { findByIds: async () => targetRows },
        blockedChannels: c.blockedChannels,
      });
      if (c.deleted) {
        h.posts.set(id(10), post(id(10), "900"));
      }

      const request = await h.service.toPreviewRequestWithAccess(
        suggestion([id(10)]),
        {
          guildId: GUILD,
          targetId: TARGET,
          actionTime: new Date("2026-11-10T18:22:00Z"),
          actionNoun: "ban",
        },
        c.access,
      );

      expect(request).toBeNull();
    }
  });
});

describe("ProofSuggestionService.findWithAccess", () => {
  test("suggests nothing when the message log is off", async () => {
    const findLatest = mock(async () => [row(10, TARGET)]);
    const h = harness({
      messageLog: false,
      messages: { findLatestTargetMessages: findLatest },
    });

    const suggestions = await h.service.findWithAccess(
      { guildId: GUILD, targetId: TARGET, actionTime: new Date() },
      openAccess,
    );

    expect(suggestions).toEqual([]);
    expect(findLatest).not.toHaveBeenCalled();
  });
});

describe("viewerAccessFromMember", () => {
  function member(perms: Record<string, bigint[]>): GuildMember {
    return {
      guild: {
        channels: {
          resolve: (channelId: string) =>
            channelId in perms
              ? { id: channelId, name: `c${channelId}` }
              : null,
        },
      },
      permissionsIn: (channel: { id: string }) => ({
        has: (required: bigint[]) =>
          required.every((p) => perms[channel.id].includes(p)),
      }),
    } as unknown as GuildMember;
  }

  test("needs ViewChannel + ReadMessageHistory to read; unknown channels are denied", () => {
    const access = viewerAccessFromMember(
      member({
        a: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ],
        b: [PermissionFlagsBits.ViewChannel],
      }),
    );

    expect(access.canRead("a")).toBe(true);
    expect(access.canRead("b")).toBe(false);
    expect(access.canView("b")).toBe(true);
    expect(access.canView("missing")).toBe(false);
    expect(access.channelName("a")).toBe("ca");
    expect(access.channelName("missing")).toBeNull();
  });
});

describe("ProofSuggestionService.hasCandidates", () => {
  test("excludes saved direct and bulk-log links before grouping and fingerprinting", async () => {
    const h = harness({
      messages: {
        countTargetMessagesByChannel: async () => new Map([[CHANNEL, 4]]),
        findLatestTargetMessages: async () =>
          [1, 2, 3, 4].map((n) => row(n, TARGET)),
      },
    });
    h.posts.set(id(2), post(id(2), "900"));
    h.posts.set(id(3), post(id(3), "900"));
    const input = {
      guildId: GUILD,
      targetId: TARGET,
      actionTime: new Date(),
      savedMessageLinks: [
        messageUrl(GUILD, CHANNEL, id(1)),
        messageUrl(GUILD, LOG, "900"),
      ],
    };
    const remaining = await h.service.findWithAccess(input, openAccess);
    expect(remaining.map((s) => s.messageIds)).toEqual([[id(4)]]);
    expect(remaining[0].kind).toBe("recent");
    expect(remaining[0].totalInWindow).toBe(1);
    expect(remaining[0].snippet).toBe("m4");
    expect(await h.service.hasCandidates(input)).toBe(true);
    input.savedMessageLinks.push(messageUrl(GUILD, CHANNEL, id(4)));
    expect(await h.service.findWithAccess(input, openAccess)).toEqual([]);
    expect(await h.service.hasCandidates(input)).toBe(false);
    expect(h.checks).toEqual([]);
  });
  const input = {
    guildId: GUILD,
    targetId: TARGET,
    actionTime: new Date(Date.UTC(2026, 10, 10, 19)),
  };

  test("true when the target has cached messages or AutoMod alerts", async () => {
    const withMessages = harness({
      messages: {
        countTargetMessagesByChannel: async () => new Map([[CHANNEL, 3]]),
      },
    });
    expect(await withMessages.service.hasCandidates(input)).toBe(true);

    const withAlert = harness({
      messages: { findTargetAutomodAlerts: async () => [row(1, TARGET)] },
    });
    expect(await withAlert.service.hasCandidates(input)).toBe(true);
  });

  test("false with nothing cached or the message log off", async () => {
    expect(await harness({}).service.hasCandidates(input)).toBe(false);

    const logOff = harness({
      messageLog: false,
      messages: {
        countTargetMessagesByChannel: async () => new Map([[CHANNEL, 3]]),
      },
    });
    expect(await logOff.service.hasCandidates(input)).toBe(false);
  });
});
