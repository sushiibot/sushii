import { describe, expect, mock, test } from "bun:test";
import {
  type Client,
  GatewayDispatchEvents,
  type GatewayDispatchPayload,
  MessageType,
  PermissionFlagsBits,
} from "discord.js";
import pino from "pino";

import type { MemberScreeningService } from "../../application/MemberScreeningService";
import type { ScreeningGuildRepository } from "../../domain/repositories/ScreeningGuildRepository";
import { ScreeningMessageHandler } from "./ScreeningMessageHandler";

const GUILD = "100000000000000001";
const OWNER = "200000000000000009";
const USER = "200000000000000001";
const MOD_ROLE = "800000000000000001";
const MEMBER_ROLE = "800000000000000002";
const ADMIN_ROLE = "800000000000000003";

function role(bits: bigint) {
  return { permissions: { bitfield: bits } };
}

const guild = {
  id: GUILD,
  ownerId: OWNER,
  roles: {
    cache: new Map([
      [GUILD, role(PermissionFlagsBits.SendMessages)],
      [MOD_ROLE, role(PermissionFlagsBits.ManageMessages)],
      [MEMBER_ROLE, role(PermissionFlagsBits.AttachFiles)],
      [ADMIN_ROLE, role(PermissionFlagsBits.Administrator)],
    ]),
  },
};

function event(
  overrides: Record<string, unknown> = {},
  t: GatewayDispatchEvents = GatewayDispatchEvents.MessageCreate,
): GatewayDispatchPayload {
  return {
    t,
    d: {
      id: "500000000000000001",
      guild_id: GUILD,
      channel_id: "300000000000000001",
      type: MessageType.Default,
      content: "hello there",
      timestamp: "2026-03-10T12:00:00.000Z",
      embeds: [],
      author: {
        id: USER,
        username: "member",
        global_name: "Member",
        avatar: "userhash",
      },
      member: {
        roles: [MEMBER_ROLE],
        joined_at: "2026-03-10T10:00:00.000Z",
        nick: null,
        avatar: null,
      },
      ...overrides,
    },
  } as unknown as GatewayDispatchPayload;
}

function setup(hasSettings = true) {
  const screenMessage = mock(async () => undefined);
  const findByGuildId = mock(async () =>
    hasSettings ? { guildId: GUILD } : null,
  );
  const logger = pino({ level: "silent" });
  const warn = mock(() => undefined);
  logger.warn = warn as unknown as typeof logger.warn;
  let now = 0;
  const handler = new ScreeningMessageHandler(
    { screenMessage } as unknown as MemberScreeningService,
    { findByGuildId } as unknown as ScreeningGuildRepository,
    {
      guilds: { cache: new Map([[GUILD, guild]]) },
    } as unknown as Client,
    logger,
    () => now,
  );
  const advance = (ms: number) => {
    now += ms;
  };
  return { handler, screenMessage, findByGuildId, warn, advance };
}

describe("ScreeningMessageHandler", () => {
  test("screens a new member's message", async () => {
    const t = setup();

    await t.handler.handle(event());

    expect(t.screenMessage).toHaveBeenCalledWith(
      {
        id: "500000000000000001",
        guildId: GUILD,
        channelId: "300000000000000001",
        content: "hello there",
        createdAt: new Date("2026-03-10T12:00:00.000Z"),
        embeds: [],
        author: { id: USER, avatar: "userhash", name: "Member" },
        member: {
          joinedAt: new Date("2026-03-10T10:00:00.000Z"),
          avatar: null,
        },
      },
      { skipText: false },
    );
  });

  test("updates skip the text check", async () => {
    const t = setup();

    await t.handler.handle(event({}, GatewayDispatchEvents.MessageUpdate));

    expect(t.screenMessage).toHaveBeenCalledWith(expect.anything(), {
      skipText: true,
    });
  });

  test("skips guilds without settings", async () => {
    const t = setup(false);

    await t.handler.handle(event());

    expect(t.screenMessage).not.toHaveBeenCalled();
  });

  test.each([
    ["bots", { author: { id: USER, bot: true, username: "b" } }],
    ["webhooks", { webhook_id: "900000000000000001" }],
    ["system messages", { type: MessageType.AutoModerationAction }],
    ["DMs", { guild_id: undefined }],
    ["payloads without joined_at", { member: { roles: [] } }],
    [
      "moderators",
      { member: { roles: [MOD_ROLE], joined_at: "2026-03-10T10:00:00Z" } },
    ],
    [
      "administrators",
      { member: { roles: [ADMIN_ROLE], joined_at: "2026-03-10T10:00:00Z" } },
    ],
    [
      "the owner",
      {
        author: { id: OWNER, username: "owner" },
        member: { roles: [], joined_at: "2026-03-10T10:00:00Z" },
      },
    ],
  ])("ignores %s", async (_name, overrides) => {
    const t = setup();

    await t.handler.handle(event(overrides));

    expect(t.screenMessage).not.toHaveBeenCalled();
  });
});

describe("ScreeningMessageHandler @everyone permissions", () => {
  test("@everyone moderator bits exempt every member", async () => {
    const everyoneMods = {
      ...guild,
      roles: {
        cache: new Map([
          [GUILD, role(PermissionFlagsBits.ModerateMembers)],
          [MEMBER_ROLE, role(PermissionFlagsBits.AttachFiles)],
        ]),
      },
    };
    const screenMessage = mock(async () => undefined);
    const handler = new ScreeningMessageHandler(
      { screenMessage } as unknown as MemberScreeningService,
      {
        findByGuildId: async () => ({ guildId: GUILD }),
      } as unknown as ScreeningGuildRepository,
      {
        guilds: { cache: new Map([[GUILD, everyoneMods]]) },
      } as unknown as Client,
      pino({ level: "silent" }),
    );

    await handler.handle(event());

    expect(screenMessage).not.toHaveBeenCalled();
  });
});

describe("ScreeningMessageHandler settings lookup failure", () => {
  test("skips screening and warns at most once per minute", async () => {
    const t = setup();
    t.findByGuildId.mockImplementation(async () => {
      throw new Error("db down");
    });

    await t.handler.handle(event());
    t.advance(30_000);
    await t.handler.handle(event());
    t.advance(30_000);
    await t.handler.handle(event());

    expect(t.screenMessage).not.toHaveBeenCalled();
    expect(t.warn).toHaveBeenCalledTimes(2);
  });
});
