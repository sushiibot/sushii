import { describe, expect, test } from "bun:test";
import { type Guild, PermissionFlagsBits } from "discord.js";

import { isScreeningExempt } from "./screeningExemption";

const GUILD = "100000000000000001";
const OWNER = "200000000000000009";
const USER = "200000000000000001";
const ROLE = "800000000000000001";

function guildWith(roleBits: bigint, everyoneBits = 0n): Guild {
  return {
    id: GUILD,
    ownerId: OWNER,
    roles: {
      cache: new Map([
        [GUILD, { permissions: { bitfield: everyoneBits } }],
        [ROLE, { permissions: { bitfield: roleBits } }],
      ]),
    },
  } as unknown as Guild;
}

describe("isScreeningExempt", () => {
  test("exempts the owner", () => {
    expect(isScreeningExempt(guildWith(0n), OWNER, [])).toBe(true);
  });

  test.each([
    ["Administrator", PermissionFlagsBits.Administrator],
    ["ManageGuild", PermissionFlagsBits.ManageGuild],
    ["ManageMessages", PermissionFlagsBits.ManageMessages],
    ["ModerateMembers", PermissionFlagsBits.ModerateMembers],
    ["BanMembers", PermissionFlagsBits.BanMembers],
    ["KickMembers", PermissionFlagsBits.KickMembers],
  ])("exempts members whose role grants %s", (_name, bit) => {
    expect(isScreeningExempt(guildWith(bit), USER, [ROLE])).toBe(true);
  });

  test("screens members without moderator permissions", () => {
    const guild = guildWith(
      PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles,
    );

    expect(isScreeningExempt(guild, USER, [ROLE])).toBe(false);
  });

  test("ignores roles the member doesn't have", () => {
    expect(
      isScreeningExempt(guildWith(PermissionFlagsBits.BanMembers), USER, []),
    ).toBe(false);
  });

  test("applies @everyone permissions to every member", () => {
    const guild = guildWith(0n, PermissionFlagsBits.KickMembers);

    expect(isScreeningExempt(guild, USER, [])).toBe(true);
  });
});
