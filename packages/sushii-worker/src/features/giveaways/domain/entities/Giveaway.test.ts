import { describe, expect, it } from "bun:test";
import type { GuildMember } from "discord.js";

import type { GiveawayData } from "./Giveaway";
import { Giveaway } from "./Giveaway";

function makeGiveaway(overrides: Partial<GiveawayData> = {}): Giveaway {
  return new Giveaway({
    id: "100",
    channelId: "200",
    guildId: "300",
    hostUserId: "400",
    numWinners: 1,
    prize: "Prize",
    startAt: new Date("2026-01-01T00:00:00Z"),
    endAt: new Date("2026-01-02T00:00:00Z"),
    isEnded: false,
    ...overrides,
  });
}

interface MemberOptions {
  roleIds?: string[];
  premiumSince?: Date | null;
  guildAvatar?: string | null;
  guildBanner?: string | null;
  userAvatar?: string | null;
  userBanner?: string | null;
}

function makeMember(options: MemberOptions = {}): GuildMember {
  const roleIds = new Set(options.roleIds ?? []);

  return {
    roles: { cache: { has: (id: string) => roleIds.has(id) } },
    premiumSince: options.premiumSince ?? null,
    avatar: options.guildAvatar ?? null,
    banner: options.guildBanner ?? null,
    user: {
      avatar: options.userAvatar ?? null,
      // undefined means the banner was not fetched
      banner: options.userBanner,
    },
  } as unknown as GuildMember;
}

describe("Giveaway.checkEligibility", () => {
  it("is eligible when there are no requirements", () => {
    const result = makeGiveaway().checkEligibility(makeMember(), 0);
    expect(result.eligible).toBe(true);
  });

  it("checks min and max level", () => {
    const giveaway = makeGiveaway({
      requiredMinLevel: 5,
      requiredMaxLevel: 10,
    });

    expect(giveaway.checkEligibility(makeMember(), 4).eligible).toBe(false);
    expect(giveaway.checkEligibility(makeMember(), 5).eligible).toBe(true);
    expect(giveaway.checkEligibility(makeMember(), 10).eligible).toBe(true);
    expect(giveaway.checkEligibility(makeMember(), 11).eligible).toBe(false);
  });

  it("checks the required role", () => {
    const giveaway = makeGiveaway({ requiredRoleId: "role" });

    expect(giveaway.checkEligibility(makeMember(), 0).eligible).toBe(false);
    expect(
      giveaway.checkEligibility(makeMember({ roleIds: ["role"] }), 0).eligible,
    ).toBe(true);
  });

  it("checks booster status in both directions", () => {
    const booster = makeMember({ premiumSince: new Date() });
    const nonBooster = makeMember();

    const mustBoost = makeGiveaway({ requiredBoosting: true });
    expect(mustBoost.checkEligibility(booster, 0).eligible).toBe(true);
    expect(mustBoost.checkEligibility(nonBooster, 0).eligible).toBe(false);

    const mustNotBoost = makeGiveaway({ requiredBoosting: false });
    expect(mustNotBoost.checkEligibility(booster, 0).eligible).toBe(false);
    expect(mustNotBoost.checkEligibility(nonBooster, 0).eligible).toBe(true);
  });

  describe("nitro requirement", () => {
    const nitroMembers: [string, GuildMember][] = [
      ["animated avatar", makeMember({ userAvatar: "a_abc123" })],
      ["server avatar", makeMember({ guildAvatar: "abc123" })],
      ["server banner", makeMember({ guildBanner: "abc123" })],
      ["profile banner", makeMember({ userBanner: "abc123" })],
    ];

    it.each(nitroMembers)(
      "requiredNitroState=nitro accepts a member with a %s",
      (_name, member) => {
        const giveaway = makeGiveaway({ requiredNitroState: "nitro" });
        expect(giveaway.checkEligibility(member, 0).eligible).toBe(true);
      },
    );

    it.each(nitroMembers)(
      "requiredNitroState=none rejects a member with a %s",
      (_name, member) => {
        const giveaway = makeGiveaway({ requiredNitroState: "none" });
        const result = giveaway.checkEligibility(member, 0);
        expect(result.eligible).toBe(false);
      },
    );

    it("requiredNitroState=nitro rejects a member without visible Nitro perks", () => {
      const giveaway = makeGiveaway({ requiredNitroState: "nitro" });
      const member = makeMember({ userAvatar: "abc123", userBanner: null });

      const result = giveaway.checkEligibility(member, 0);

      expect(result.eligible).toBe(false);
      if (!result.eligible) {
        expect(result.reason).toContain("Nitro");
      }
    });

    it("requiredNitroState=none accepts a member without visible Nitro perks", () => {
      const giveaway = makeGiveaway({ requiredNitroState: "none" });
      const member = makeMember({ userAvatar: "abc123" });

      expect(giveaway.checkEligibility(member, 0).eligible).toBe(true);
    });

    it("does not treat server boosting as Nitro", () => {
      const giveaway = makeGiveaway({ requiredNitroState: "nitro" });
      const member = makeMember({ premiumSince: new Date() });

      expect(giveaway.checkEligibility(member, 0).eligible).toBe(false);
    });
  });
});
