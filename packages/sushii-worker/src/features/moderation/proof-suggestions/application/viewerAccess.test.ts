import { describe, expect, test } from "bun:test";
import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
  RESTJSONErrorCodes,
} from "discord.js";
import type { GuildMember } from "discord.js";

import { viewerAccessFromMember } from "./viewerAccess";

const VIEWER = "200000000000000010";
const PARENT = "300000000000000001";
const PRIVATE = "300000000000000002";
const PUBLIC = "300000000000000003";

const READ = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
];

function thread(
  channelId: string,
  type: ChannelType,
  opts: {
    cachedMembers?: string[];
    fetch?: () => Promise<unknown>;
  } = {},
) {
  const fetches: string[] = [];
  return {
    fetches,
    channel: {
      id: channelId,
      name: `t${channelId.slice(-1)}`,
      type,
      parentId: PARENT,
      members: {
        cache: new Map((opts.cachedMembers ?? []).map((m) => [m, {}])),
        fetch: async ({ member }: { member: string }) => {
          fetches.push(member);
          if (!opts.fetch) {
            throw new DiscordAPIError(
              { code: RESTJSONErrorCodes.UnknownMember, message: "Unknown" },
              RESTJSONErrorCodes.UnknownMember,
              404,
              "GET",
              "/x",
              {},
            );
          }

          return opts.fetch();
        },
      },
    },
  };
}

// permissionsIn(thread) mirrors discord.js: a thread reports its parent's permissions.
function member(
  channels: { id: string }[],
  parentPerms: bigint[],
): GuildMember {
  const byId = new Map(channels.map((c) => [c.id, c]));
  return {
    id: VIEWER,
    guild: { channels: { resolve: (id: string) => byId.get(id) ?? null } },
    permissionsIn: () => new PermissionsBitField(parentPerms),
  } as unknown as GuildMember;
}

describe("viewerAccessFromMember: private threads", () => {
  test("parent read access alone doesn't open a private thread", async () => {
    const t = thread(PRIVATE, ChannelType.PrivateThread);
    const access = viewerAccessFromMember(member([t.channel], READ));

    expect(access.canRead(PRIVATE)).toBe(false);
    await access.prepare([PRIVATE]);
    expect(t.fetches).toEqual([VIEWER]);
    expect(access.canRead(PRIVATE)).toBe(false);
    expect(access.canView(PRIVATE)).toBe(false);
  });

  test("a cached thread member can read without a fetch", async () => {
    const t = thread(PRIVATE, ChannelType.PrivateThread, {
      cachedMembers: [VIEWER],
    });
    const access = viewerAccessFromMember(member([t.channel], READ));

    await access.prepare([PRIVATE]);
    expect(t.fetches).toEqual([]);
    expect(access.canRead(PRIVATE)).toBe(true);
  });

  test("membership resolved by fetch allows; it is fetched once", async () => {
    const t = thread(PRIVATE, ChannelType.PrivateThread, {
      fetch: async () => ({}),
    });
    const access = viewerAccessFromMember(member([t.channel], READ));

    await access.prepare([PRIVATE, PRIVATE]);
    await access.prepare([PRIVATE]);
    expect(t.fetches).toEqual([VIEWER]);
    expect(access.canRead(PRIVATE)).toBe(true);
  });

  test("any other fetch failure denies", async () => {
    const t = thread(PRIVATE, ChannelType.PrivateThread, {
      fetch: async () => {
        throw new Error("gateway down");
      },
    });
    const access = viewerAccessFromMember(member([t.channel], READ));

    await access.prepare([PRIVATE]);
    expect(access.canRead(PRIVATE)).toBe(false);
  });

  test("ManageThreads opens private threads without membership", async () => {
    const t = thread(PRIVATE, ChannelType.PrivateThread);
    const access = viewerAccessFromMember(
      member([t.channel], [...READ, PermissionFlagsBits.ManageThreads]),
    );

    expect(access.canRead(PRIVATE)).toBe(true);
  });

  test("public threads use the parent's permissions", async () => {
    const t = thread(PUBLIC, ChannelType.PublicThread);
    const access = viewerAccessFromMember(member([t.channel], READ));

    await access.prepare([PUBLIC]);
    expect(t.fetches).toEqual([]);
    expect(access.canRead(PUBLIC)).toBe(true);
  });
});
