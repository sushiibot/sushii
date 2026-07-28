import { describe, expect, it, mock } from "bun:test";
import type { User } from "discord.js";
import { pino } from "pino";

import type { EmojiMap } from "@/features/bot-emojis";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";

import type { ModViewResult } from "../application/ModViewService";
import { ModViewSession } from "./ModViewSession";

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
  };
}

/**
 * Bare enough to drive `start()`: a fresh chat-input interaction whose
 * `reply()` resolves to a fetchable `InteractionResponse`-shaped stub, itself
 * resolving to a `Message`-shaped stub with `edit` and a fake collector.
 */
function makeInteraction() {
  const editReply = mock(() =>
    Promise.reject(new Error("editReply should never be called")),
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
    fetch: mock(() => Promise.resolve(msg)),
  };

  const interaction = {
    isChatInputCommand: () => false,
    reply: mock(() => Promise.resolve(response)),
    editReply,
    guildId: GUILD_ID,
    guild: { id: GUILD_ID },
    user: { id: EXECUTOR_ID },
  };

  return { interaction, response, msg, collector, collectorHandlers };
}

describe("ModViewSession expiry", () => {
  it("edits the fetched message on collector end, never the interaction's webhook reply", async () => {
    const { interaction, response, msg, collectorHandlers } = makeInteraction();

    const session = new ModViewSession(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      interaction as any,
      makeEmptyData(),
      makeUser(),
      null,
      mockEmojis,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {} as any,
      pino({ level: "silent" }),
    );

    await session.start();

    // FIX 1: the message actually collected on is the one `response.fetch()`
    // returns, not the `InteractionResponse` itself.
    expect(response.fetch).toHaveBeenCalled();
    expect(msg.createMessageComponentCollector).toHaveBeenCalled();

    // Simulate the collector idling out after 15+ minutes.
    await collectorHandlers.end();

    // The fetched `Message#edit` uses the bot token and never expires.
    expect(msg.edit).toHaveBeenCalled();
    // `InteractionResponse#edit`/`editReply` would use the original
    // interaction's webhook token, which Discord expires after 15 minutes —
    // exactly the bug this regression pins.
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});
