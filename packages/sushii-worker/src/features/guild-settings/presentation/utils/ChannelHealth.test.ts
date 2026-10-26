import { describe, expect, test } from "bun:test";
import type { Guild } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type { ChannelHealth } from "../../application/SettingsStatus";
import { checkChannelHealth } from "./ChannelHealth";

const CHANNEL_ID = "234567890123456789";
const OTHER_CHANNEL_ID = "234567890123456790";
const BOT_ID = "345678901234567890";

type Flag = bigint;

function stubGuild(opts: {
  channels?: Record<string, Flag[] | null>;
  hasMe?: boolean;
  textBased?: boolean;
}): Guild {
  const me = opts.hasMe === false ? null : { id: BOT_ID };
  const cache = new Map(
    Object.entries(opts.channels ?? {}).map(([id, granted]) => [
      id,
      {
        id,
        isTextBased: () => opts.textBased !== false,
        permissionsFor: () =>
          granted === null
            ? null
            : { has: (flag: Flag) => granted.includes(flag) },
      },
    ]),
  );

  return { channels: { cache }, members: { me } } as unknown as Guild;
}

const ALL = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

describe("checkChannelHealth", () => {
  test.each<{ name: string; granted: Flag[] | null; expected: ChannelHealth }>([
    {
      name: "all permissions granted",
      granted: ALL,
      expected: { kind: "ok" },
    },
    {
      name: "nothing granted lists all three in order",
      granted: [],
      expected: {
        kind: "missing_permissions",
        permissions: ["View Channel", "Send Messages", "Embed Links"],
      },
    },
    {
      name: "only embed links missing",
      granted: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
      ],
      expected: { kind: "missing_permissions", permissions: ["Embed Links"] },
    },
    {
      name: "view and embed missing",
      granted: [PermissionFlagsBits.SendMessages],
      expected: {
        kind: "missing_permissions",
        permissions: ["View Channel", "Embed Links"],
      },
    },
    {
      name: "permissionsFor returns null",
      granted: null,
      expected: { kind: "missing_channel" },
    },
  ])("$name", ({ granted, expected }) => {
    const guild = stubGuild({ channels: { [CHANNEL_ID]: granted } });

    expect(checkChannelHealth(guild, [CHANNEL_ID]).get(CHANNEL_ID)).toEqual(
      expected,
    );
  });

  test("channel not in cache is missing_channel", () => {
    const guild = stubGuild({ channels: {} });

    expect(checkChannelHealth(guild, [CHANNEL_ID]).get(CHANNEL_ID)).toEqual({
      kind: "missing_channel",
    });
  });

  test("bot member not cached is missing_channel", () => {
    const guild = stubGuild({ channels: { [CHANNEL_ID]: ALL }, hasMe: false });

    expect(checkChannelHealth(guild, [CHANNEL_ID]).get(CHANNEL_ID)).toEqual({
      kind: "missing_channel",
    });
  });

  test("non-text channel is missing_channel", () => {
    const guild = stubGuild({
      channels: { [CHANNEL_ID]: ALL },
      textBased: false,
    });

    expect(checkChannelHealth(guild, [CHANNEL_ID]).get(CHANNEL_ID)).toEqual({
      kind: "missing_channel",
    });
  });

  test("returns one entry per distinct channel", () => {
    const guild = stubGuild({
      channels: { [CHANNEL_ID]: ALL, [OTHER_CHANNEL_ID]: [] },
    });

    const health = checkChannelHealth(guild, [
      CHANNEL_ID,
      OTHER_CHANNEL_ID,
      CHANNEL_ID,
    ]);

    expect(health.size).toBe(2);
    expect(health.get(CHANNEL_ID)).toEqual({ kind: "ok" });
    expect(health.get(OTHER_CHANNEL_ID)?.kind).toBe("missing_permissions");
  });
});
