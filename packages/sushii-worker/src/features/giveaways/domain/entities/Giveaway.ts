import type { GuildMember } from "discord.js";

export interface GiveawayData {
  id: string;
  channelId: string;
  guildId: string;
  hostUserId: string;
  numWinners: number;
  prize: string;
  requiredRoleId?: string;
  requiredMinLevel?: number;
  requiredMaxLevel?: number;
  requiredNitroState?: "none" | "nitro";
  requiredBoosting?: boolean;
  startAt: Date;
  endAt: Date;
  isEnded: boolean;
}

export type GiveawayEligibility =
  | { eligible: true }
  | { eligible: false; reason: string };

/**
 * Discord doesn't expose a user's Nitro subscription to bots, so Nitro is
 * inferred from perks only Nitro users can have: an animated avatar, a
 * server-specific avatar or banner, or a profile banner. Users with Nitro who
 * use none of these perks can't be detected. Server boosting is not Nitro, as
 * boosts can be bought without a subscription.
 *
 * The profile banner is only known when the user was fetched, so it's an
 * extra signal rather than a requirement.
 */
export function hasVisibleNitroPerks(member: GuildMember): boolean {
  return !!(
    member.user.avatar?.startsWith("a_") ||
    member.avatar ||
    member.banner ||
    member.user.banner
  );
}

export class Giveaway {
  constructor(private readonly data: GiveawayData) {}

  get id(): string {
    return this.data.id;
  }

  get channelId(): string {
    return this.data.channelId;
  }

  get guildId(): string {
    return this.data.guildId;
  }

  get hostUserId(): string {
    return this.data.hostUserId;
  }

  get numWinners(): number {
    return this.data.numWinners;
  }

  get prize(): string {
    return this.data.prize;
  }

  get requiredRoleId(): string | undefined {
    return this.data.requiredRoleId;
  }

  get requiredMinLevel(): number | undefined {
    return this.data.requiredMinLevel;
  }

  get requiredMaxLevel(): number | undefined {
    return this.data.requiredMaxLevel;
  }

  get requiredNitroState(): "none" | "nitro" | undefined {
    return this.data.requiredNitroState;
  }

  get requiredBoosting(): boolean | undefined {
    return this.data.requiredBoosting;
  }

  get startAt(): Date {
    return this.data.startAt;
  }

  get endAt(): Date {
    return this.data.endAt;
  }

  get isEnded(): boolean {
    return this.data.isEnded;
  }

  isExpired(): boolean {
    return new Date() >= this.data.endAt;
  }

  hasRequirements(): boolean {
    return !!(
      this.data.requiredRoleId ||
      this.data.requiredMinLevel ||
      this.data.requiredMaxLevel ||
      this.data.requiredBoosting !== undefined ||
      this.data.requiredNitroState
    );
  }

  checkEligibility(
    member: GuildMember,
    userLevel: number,
  ): GiveawayEligibility {
    if (this.data.requiredMinLevel !== undefined) {
      if (userLevel < this.data.requiredMinLevel) {
        return {
          eligible: false,
          reason: `You need to be at least level ${this.data.requiredMinLevel}`,
        };
      }
    }

    if (this.data.requiredMaxLevel !== undefined) {
      if (userLevel > this.data.requiredMaxLevel) {
        return {
          eligible: false,
          reason: `You need to be at most level ${this.data.requiredMaxLevel}`,
        };
      }
    }

    if (this.data.requiredRoleId) {
      if (!member.roles.cache.has(this.data.requiredRoleId)) {
        return {
          eligible: false,
          reason: `You need the <@&${this.data.requiredRoleId}> role`,
        };
      }
    }

    if (this.data.requiredBoosting !== undefined) {
      if (this.data.requiredBoosting === true && !member.premiumSince) {
        return {
          eligible: false,
          reason: "You need to be a server booster",
        };
      }

      if (this.data.requiredBoosting === false && member.premiumSince) {
        return {
          eligible: false,
          reason: "You need to __not__ be a server booster",
        };
      }
    }

    if (this.data.requiredNitroState !== undefined) {
      const hasNitro = hasVisibleNitroPerks(member);

      if (this.data.requiredNitroState === "nitro" && !hasNitro) {
        return {
          eligible: false,
          reason:
            "You need Discord Nitro. Nitro is detected from Nitro-only profile perks: an animated avatar, a server avatar, or a profile banner",
        };
      }

      if (this.data.requiredNitroState === "none" && hasNitro) {
        return {
          eligible: false,
          reason: "You need to __not__ have Discord Nitro",
        };
      }
    }

    return { eligible: true };
  }

  toData(): GiveawayData {
    return { ...this.data };
  }

  static fromData(data: GiveawayData): Giveaway {
    return new Giveaway(data);
  }
}
