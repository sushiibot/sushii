import { describe, expect, it, mock } from "bun:test";
import { MessageFlags } from "discord.js";
import type { User } from "discord.js";
import { pino } from "pino";

import type { EmojiMap } from "@/features/bot-emojis";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import type { CaseProof } from "@/features/moderation/shared/domain/entities/CaseProof";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import type { ModViewResult } from "../application/ModViewService";
import { ModViewSession } from "./ModViewSession";
import { MODVIEW_CUSTOM_IDS } from "./customIds";

const GUILD_ID = "111111111111111111";
const TARGET_ID = "222222222222222222";
const EXECUTOR_ID = "333333333333333333";

const mockEmojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

function makeUser(): User {
  return {
    id: TARGET_ID,
    username: "target_user",
    globalName: "Target",
    createdTimestamp: Date.now() - 1000 * 60 * 60 * 24 * 365,
    displayAvatarURL: () => "https://example.com/avatar.png",
  } as unknown as User;
}

function makeEmptyData(): ModViewResult {
  const emptyUserInfo = {
    id: TARGET_ID,
    username: "target_user",
    avatarURL: "https://example.com/avatar.png",
    joinedAt: new Date(),
    isBot: false,
  };

  return {
    userInfo: emptyUserInfo,
    history: {
      userInfo: emptyUserInfo,
      moderationHistory: [],
      totalCases: 0,
      linkedIdentity: null,
    },
    lookup: {
      userInfo: emptyUserInfo,
      crossServerBans: [],
      currentGuildLookupOptIn: true,
    },
    names: {
      userInfo: emptyUserInfo,
      history: [],
      eligibilityDenied: false,
    },
    identity: null,
    standing: null,
    proofCounts: new Map(),
  };
}

/**
 * Bare enough to drive `start()`: a fresh chat-input interaction whose
 * `reply()` resolves to a `withResponse: true`-shaped `InteractionCallbackResponse`
 * stub carrying the `Message`-shaped stub directly on `resource.message`
 * (no separate `fetch()` round trip), with `edit` and a fake collector.
 */
function makeInteraction(
  options: { chatInput?: boolean; createdTimestamp?: number } = {},
) {
  const editReply = mock((_message: unknown) =>
    options.chatInput
      ? Promise.resolve()
      : Promise.reject(new Error("editReply should never be called")),
  );

  const collectorHandlers: Record<string, (...args: unknown[]) => unknown> = {};
  const collector = {
    on: mock((event: string, handler: (...args: unknown[]) => unknown) => {
      collectorHandlers[event] = handler;
      return collector;
    }),
  };

  const msg = {
    edit: mock(() => Promise.resolve()),
    createMessageComponentCollector: mock(() => collector),
  };

  const response = {
    resource: { message: msg },
  };

  const interaction = {
    isChatInputCommand: () => options.chatInput ?? false,
    createdTimestamp: options.createdTimestamp ?? Date.now(),
    reply: mock((_opts?: { flags?: number }) => Promise.resolve(response)),
    editReply,
    guildId: GUILD_ID,
    guild: { id: GUILD_ID },
    user: { id: EXECUTOR_ID },
  };

  return { interaction, response, msg, collector, collectorHandlers };
}

describe("ModViewSession expiry", () => {
  it("edits the reply's message on collector end, never the interaction's webhook reply", async () => {
    const { interaction, msg, collectorHandlers } = makeInteraction();

    const session = new ModViewSession(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction as any,
      makeEmptyData(),
      makeUser(),
      null,
      mockEmojis,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      pino({ level: "silent" }),
    );

    await session.start();

    // FIX 1: the message actually collected on is the one `reply()`'s
    // `withResponse: true` result carries on `resource.message`, not the
    // `InteractionCallbackResponse` itself.
    expect(msg.createMessageComponentCollector).toHaveBeenCalled();
    // Round 2 fix: a single `reply()` call, not a `reply()` followed by a
    // second, independently-fallible `fetch()` — closing the window where the
    // public message posts but nothing (no collector, no error path) is
    // watching it.
    expect(interaction.reply).toHaveBeenCalledTimes(1);

    // Simulate the collector idling out after 15+ minutes.
    await collectorHandlers.end();

    // The fetched `Message#edit` uses the bot token and never expires.
    expect(msg.edit).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe("ModViewSession ephemeral", () => {
  it("does not set the Ephemeral flag by default", async () => {
    const { interaction } = makeInteraction();

    const session = new ModViewSession(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction as any,
      makeEmptyData(),
      makeUser(),
      null,
      mockEmojis,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      pino({ level: "silent" }),
    );

    await session.start();

    const replyArg = interaction.reply.mock.calls[0][0];
    expect((replyArg?.flags as number) & MessageFlags.Ephemeral).toBe(0);
  });

  it("sets the Ephemeral flag when constructed with ephemeral: true", async () => {
    const { interaction } = makeInteraction();

    const session = new ModViewSession(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction as any,
      makeEmptyData(),
      makeUser(),
      null,
      mockEmojis,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      pino({ level: "silent" }),
      "overview",
      true,
    );

    await session.start();

    const replyArg = interaction.reply.mock.calls[0][0];
    expect((replyArg?.flags as number) & MessageFlags.Ephemeral).toBe(
      MessageFlags.Ephemeral,
    );
  });
});

describe("ModViewSession View case select", () => {
  function makeProof(i: number): CaseProof {
    return {
      id: `${i}`,
      guildId: GUILD_ID,
      caseId: "7",
      authorId: EXECUTOR_ID,
      createdAt: new Date(),
      content: `${i}`.repeat(1000),
      attachments: [],
      sourceMessageUrl: null,
      sourceAuthorId: null,
      sourceContent: null,
      hostMessageId: null,
      source: "button",
    };
  }

  async function pick(
    listByCase: () => Promise<CaseProof[]>,
    options: { warnDmText?: string; dmDelivered?: boolean } = {},
  ) {
    const { interaction, collectorHandlers } = makeInteraction();
    const data = makeEmptyData();
    const picked = makeModerationCase({
      guildId: GUILD_ID,
      caseId: "7",
      userId: TARGET_ID,
      reason: "spam",
    });
    data.history.moderationHistory = [
      options.dmDelivered
        ? picked.withDMResult({ channelId: "1", messageId: "2" })
        : picked,
    ];
    const guildConfig = GuildConfig.createDefault(GUILD_ID);
    const config = {
      ...guildConfig,
      moderationSettings: {
        ...guildConfig.moderationSettings,
        warnDmText: options.warnDmText ?? null,
      },
    } as GuildConfig;
    data.history.totalCases = 1;

    const caseProofRepository = {
      listByCase: mock(listByCase),
    } as unknown as CaseProofRepository;

    const session = new ModViewSession(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction as any,
      data,
      makeUser(),
      null,
      mockEmojis,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      {
        caseProofRepository,
        guildConfigRepository: {
          findByGuildId: mock(async () => config),
        },
      },
      pino({ level: "silent" }),
    );
    await session.start();

    const order: string[] = [];
    const select = {
      user: { id: EXECUTOR_ID },
      customId: MODVIEW_CUSTOM_IDS.historyCase,
      values: ["7"],
      replied: false,
      deferred: false,
      isStringSelectMenu: () => true,
      isButton: () => false,
      update: mock(() => {
        order.push("update");
        return Promise.resolve();
      }),
      followUp: mock((_message: { flags: number }) => {
        order.push("followUp");
        return Promise.resolve();
      }),
      reply: mock((_message: { flags: number }) => Promise.resolve()),
    };
    await collectorHandlers.collect(select);

    return { select, order, caseProofRepository };
  }

  it("clears the pick, then sends the picked case privately", async () => {
    const { select, order, caseProofRepository } = await pick(() =>
      Promise.resolve([]),
    );

    expect(caseProofRepository.listByCase).toHaveBeenCalledWith(GUILD_ID, "7");
    expect(order).toEqual(["update", "followUp"]);
    const sent = select.followUp.mock.calls[0][0];
    expect(sent.flags & MessageFlags.Ephemeral).toBe(MessageFlags.Ephemeral);
    expect(JSON.stringify(sent)).toContain("Case #7");
  });

  it("notes the server's DM text when the delivered DM carried it", async () => {
    const withText = await pick(() => Promise.resolve([]), {
      warnDmText: "Read the rules",
      dmDelivered: true,
    });
    expect(JSON.stringify(withText.select.followUp.mock.calls)).toContain(
      "Also included your server's warn message",
    );

    const without = await pick(() => Promise.resolve([]), {
      dmDelivered: true,
    });
    expect(JSON.stringify(without.select.followUp.mock.calls)).not.toContain(
      "Also included",
    );
  });

  it("sends every message of a split case view in order", async () => {
    const { select, order } = await pick(() =>
      Promise.resolve(Array.from({ length: 6 }, (_, i) => makeProof(i))),
    );

    expect(order[0]).toBe("update");
    expect(select.followUp.mock.calls.length).toBeGreaterThan(1);
    expect(order.slice(1).every((o) => o === "followUp")).toBe(true);
    const all = JSON.stringify(select.followUp.mock.calls);
    for (let i = 0; i < 6; i++) {
      expect(all).toContain(`${i}`.repeat(1000));
    }
  });

  it("replies with an error, untouched view, when loading proof throws", async () => {
    const { select } = await pick(() => Promise.reject(new Error("db down")));

    expect(select.update).not.toHaveBeenCalled();
    expect(select.followUp).not.toHaveBeenCalled();
    expect(select.reply).toHaveBeenCalledTimes(1);
    expect(
      (select.reply.mock.calls[0][0].flags ?? 0) & MessageFlags.Ephemeral,
    ).toBe(MessageFlags.Ephemeral);
  });
});

describe("ModViewSession proof refresh", () => {
  const PAGINATOR_FORWARD = "components_v2_paginator_forward";

  function makeHistoryData(): ModViewResult {
    const data = makeEmptyData();
    // 60 cases make several History pages, newest first.
    data.history.moderationHistory = Array.from({ length: 60 }, (_, i) =>
      makeModerationCase({
        guildId: GUILD_ID,
        caseId: `${i + 1}`,
        userId: TARGET_ID,
        reason: `reason ${i + 1}`,
      }),
    );
    data.history.totalCases = 60;
    return data;
  }

  async function open(
    initialTab: "overview" | "history",
    options: { createdTimestamp?: number } = {},
  ) {
    const ctx = makeInteraction({ chatInput: true, ...options });
    const registry = { register: mock(), unregister: mock() };
    const session = new ModViewSession(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx.interaction as any,
      makeHistoryData(),
      makeUser(),
      null,
      mockEmojis,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      pino({ level: "silent" }),
      initialTab,
      false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registry as any,
    );
    await session.start();
    return { ...ctx, session, registry };
  }

  function click(customId: string) {
    return {
      user: { id: EXECUTOR_ID },
      customId,
      replied: false,
      deferred: false,
      isStringSelectMenu: () => false,
      isButton: () => true,
      update: mock(() => Promise.resolve()),
      reply: mock(() => Promise.resolve()),
    };
  }

  function lastEdit(interaction: {
    editReply: { mock: { calls: unknown[][] } };
  }) {
    const calls = interaction.editReply.mock.calls;
    return JSON.stringify(calls[calls.length - 1][0]);
  }

  it("registers while live and unregisters when the collector ends", async () => {
    const { session, registry, collectorHandlers } = await open("history");

    expect(registry.register).toHaveBeenCalledWith(session);
    expect(session.caseIds()).toHaveLength(60);
    expect(registry.unregister).not.toHaveBeenCalled();

    await collectorHandlers.end();

    expect(registry.unregister).toHaveBeenCalledWith(session);
  });

  it("re-renders History with the new counts on the same page", async () => {
    const { session, interaction, collectorHandlers } = await open("history");
    await collectorHandlers.collect(click(PAGINATOR_FORWARD));

    await session.showProofCounts(new Map([["20", { entries: 2, files: 3 }]]));

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const edited = lastEdit(interaction);
    expect(edited).toContain('"label":"2 / ');
    expect(edited).toContain("`#20`");
    expect(edited).toContain("2 proof");
    expect(edited).toContain("3 files");
    expect(edited).not.toContain("`#60`");
  });

  it("keeps the History page for later page turns", async () => {
    const { session, interaction, collectorHandlers } = await open("history");
    await collectorHandlers.collect(click(PAGINATOR_FORWARD));
    await session.showProofCounts(new Map([["20", { entries: 1, files: 0 }]]));

    const next = click(PAGINATOR_FORWARD);
    await collectorHandlers.collect(next);

    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    const turned = JSON.stringify(
      (next.update.mock.calls as unknown[][])[0][0],
    );
    expect(turned).toContain('"label":"3 / ');
  });

  it("re-renders the active non-paginated tab in place", async () => {
    const { session, interaction } = await open("overview");

    await session.showProofCounts(new Map([["60", { entries: 4, files: 0 }]]));

    const edited = lastEdit(interaction);
    expect(edited).toContain("`#60`");
    expect(edited).toContain("4 proof");
    expect(edited).not.toContain("components_v2_paginator_current");
  });

  it("does nothing once the session has expired", async () => {
    const { session, interaction, collectorHandlers } = await open("history");
    await collectorHandlers.end();

    await session.showProofCounts(new Map([["60", { entries: 1, files: 0 }]]));

    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it("does nothing past the interaction's edit window", async () => {
    const { session, interaction } = await open("history", {
      createdTimestamp: Date.now() - 15 * 60 * 1000,
    });

    expect(session.canEdit(Date.now())).toBe(false);
    await session.showProofCounts(new Map([["60", { entries: 1, files: 0 }]]));

    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
