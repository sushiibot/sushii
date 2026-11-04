import { sleep } from "bun";
import { describe, expect, mock, test } from "bun:test";
import type { ChatInputCommandInteraction } from "discord.js";
import pino from "pino";
import { Ok } from "ts-results";

import { BanAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import {
  EXPIRED_LINE,
  buildActionResultMessage,
} from "../views/ModerationActionView";
import {
  createResponseExpiryScheduler,
  expireResponse,
  expiryDelayMs,
  staleResponse,
} from "./responseExpiry";
import {
  type LiveActionResponse,
  createActionResponseRegistry,
} from "./responseRegistry";
import {
  GUILD,
  MOD,
  makeCase,
  makeEmojis,
  makeTarget,
  makeUser,
} from "./testFixtures";

function postedReply() {
  const message = buildActionResultMessage({
    actionType: ActionType.Ban,
    executor: makeUser(MOD, "tzuyu"),
    targets: [makeTarget("912345678901234567", "spambot")],
    results: [Ok(makeCase())],
    guildConfig: GuildConfig.createDefault(GUILD),
    action: new BanAction(
      GUILD,
      makeUser(MOD, "tzuyu"),
      null,
      null,
      "unspecified",
    ),
    emojis: makeEmojis(),
  });
  return {
    components: message.components.map((c) => ({ toJSON: () => c.toJSON() })),
  };
}

describe("expiryDelayMs", () => {
  test("lands just under 15 minutes after the command", () => {
    const created = 1_000_000;
    const delay = expiryDelayMs(created, created + 5_000);
    expect(delay).toBeLessThan(15 * 60 * 1000 - 5_000);
    expect(delay).toBeGreaterThan(14 * 60 * 1000);
    expect(expiryDelayMs(created, created + 20 * 60 * 1000)).toBe(0);
  });
});

describe("expireResponse", () => {
  test("edits the reply to the expired render once", async () => {
    let reply = postedReply();
    const editReply = mock(
      async (options: { components: { toJSON(): unknown }[] }) => {
        reply = {
          components: options.components.map((c) => ({
            toJSON: () => c.toJSON(),
          })),
        } as typeof reply;
      },
    );
    const interaction = {
      fetchReply: mock(async () => reply),
      editReply,
    } as unknown as ChatInputCommandInteraction;

    expect(await expireResponse(interaction)).toBe(true);
    expect(JSON.stringify(reply.components[0].toJSON())).toContain(
      JSON.stringify(EXPIRED_LINE).slice(1, -1),
    );
    expect(await expireResponse(interaction)).toBe(false);
    expect(editReply).toHaveBeenCalledTimes(1);
  });
});

function liveInteraction(createdTimestamp: number) {
  let reply = { id: "1029384756102938500", ...postedReply() };
  const editReply = mock(
    async (options: { components: { toJSON(): unknown }[] }) => {
      reply = {
        id: reply.id,
        components: options.components.map((c) => ({
          toJSON: () => c.toJSON(),
        })),
      } as typeof reply;
    },
  );
  return {
    interaction: {
      id: "1558174981962080000",
      createdTimestamp,
      fetchReply: mock(async () => reply),
      editReply,
    },
    editReply,
    current: () => JSON.stringify(reply.components[0].toJSON()),
  };
}

describe("staleness", () => {
  test("markStale edits the reply to the stale state, disabled, once", async () => {
    const now = Date.now();
    const registry = createActionResponseRegistry();
    const schedule = createResponseExpiryScheduler(registry, {
      now: () => now,
    });
    const live = liveInteraction(now);

    schedule(
      live.interaction as unknown as ChatInputCommandInteraction,
      pino({ level: "silent" }),
      { guildId: GUILD, caseIds: ["4822"] },
    );
    await sleep(0);

    await registry.markStale(GUILD, ["4822"], {
      exceptMessageId: "1029384756102938500",
    });
    expect(live.editReply).not.toHaveBeenCalled();

    await registry.markStale(GUILD, ["4822"]);
    await registry.markStale(GUILD, ["4822"]);
    expect(live.editReply).toHaveBeenCalledTimes(1);
    expect(live.current()).toContain(
      "Changed in the mod log after this was posted. The mod log entry is up to date.",
    );
    expect(live.current()).not.toContain('"disabled":false');
  });

  test("without a registration nothing is registered", async () => {
    const now = Date.now();
    const registry = createActionResponseRegistry();
    const live = liveInteraction(now);
    createResponseExpiryScheduler(registry, { now: () => now })(
      live.interaction as unknown as ChatInputCommandInteraction,
      pino({ level: "silent" }),
    );
    await sleep(0);

    await registry.markStale(GUILD, ["4822"]);
    expect(live.interaction.fetchReply).not.toHaveBeenCalled();
  });

  test("past the window the reply is left alone", async () => {
    const created = 1_000_000;
    const live = liveInteraction(created);
    const marked = await staleResponse(
      live.interaction as unknown as ChatInputCommandInteraction,
      created + 15 * 60 * 1000,
      null,
    );
    expect(marked).toBe(false);
    expect(live.interaction.fetchReply).not.toHaveBeenCalled();
  });

  test("an expired reply doesn't turn stale", async () => {
    const created = Date.now();
    const live = liveInteraction(created);
    const interaction =
      live.interaction as unknown as ChatInputCommandInteraction;
    expect(await expireResponse(interaction)).toBe(true);
    expect(await staleResponse(interaction, created, null)).toBe(false);
    expect(live.editReply).toHaveBeenCalledTimes(1);
  });
});

const MOD_LOG_URL =
  "https://discord.com/channels/187450744427773963/1029384756102938400/1029384756102938499";

describe("staleness with the mod log link", () => {
  test("the stale line links the entry, resolved when marked", async () => {
    const now = Date.now();
    const registry = createActionResponseRegistry();
    const resolveModLogUrl = mock(async () => MOD_LOG_URL);
    const live = liveInteraction(now);
    createResponseExpiryScheduler(registry, {
      now: () => now,
      resolveModLogUrl,
    })(
      live.interaction as unknown as ChatInputCommandInteraction,
      pino({ level: "silent" }),
      { guildId: GUILD, caseIds: ["4822"], messageId: "1029384756102938500" },
    );

    expect(live.interaction.fetchReply).not.toHaveBeenCalled();
    expect(resolveModLogUrl).not.toHaveBeenCalled();

    await registry.markStale(GUILD, ["4822"]);
    expect(resolveModLogUrl).toHaveBeenCalledWith(GUILD, ["4822"]);
    expect(live.current()).toContain(`Up-to-date entry: ${MOD_LOG_URL}`);
  });

  test("a failed lookup still marks it stale, without the link", async () => {
    const now = Date.now();
    const registry = createActionResponseRegistry();
    const live = liveInteraction(now);
    createResponseExpiryScheduler(registry, {
      now: () => now,
      resolveModLogUrl: async () => {
        throw new Error("db down");
      },
    })(
      live.interaction as unknown as ChatInputCommandInteraction,
      pino({ level: "silent" }),
      { guildId: GUILD, caseIds: ["4822"], messageId: "1029384756102938500" },
    );

    await registry.markStale(GUILD, ["4822"]);
    expect(live.current()).toContain("The mod log entry is up to date.");
  });

  test("the expiry timer unregisters the entry", async () => {
    const created = 1_000_000;
    const unregister = mock((_entry: LiveActionResponse) => undefined);
    const register = mock((_entry: LiveActionResponse) => undefined);
    const live = liveInteraction(created);
    createResponseExpiryScheduler(
      { register, unregister, markStale: async () => undefined },
      { now: () => created + 20 * 60 * 1000 },
    )(
      live.interaction as unknown as ChatInputCommandInteraction,
      pino({ level: "silent" }),
      { guildId: GUILD, caseIds: ["4822"], messageId: "1029384756102938500" },
    );

    await sleep(5);
    expect(register).toHaveBeenCalledTimes(1);
    expect(unregister).toHaveBeenCalledWith(register.mock.calls[0][0]);
  });
});
