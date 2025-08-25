import type { Client } from "discord.js";
import type { User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { UserInfo } from "../../shared/domain/types/UserInfo";
import type { UserLookupBan } from "../domain/entities/UserLookupBan";
import type { UserLookupRepository } from "../domain/repositories/UserLookupRepository";

export interface UserLookupResult {
  userInfo: UserInfo;
  crossServerBans: UserLookupBan[];
  currentGuildLookupOptIn: boolean;
}

export class LookupUserService {
  constructor(
    private readonly client: Client,
    private readonly userLookupRepository: UserLookupRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  async lookupUser(
    guildId: string,
    userId: string,
  ): Promise<Result<UserLookupResult, string>> {
    const log = this.logger.child({ guildId, userId });

    log.info("Looking up user information");

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return Err("Guild not found");
    }

    // Get current guild's lookup opt-in status
    const guildConfig = await this.guildConfigRepository.findByGuildId(guildId);
    const currentGuildLookupOptIn =
      guildConfig.moderationSettings.lookupDetailsOptIn;

    const member = guild.members.cache.get(userId);
    let user: User | null = null;

    if (member) {
      user = member.user;
    } else {
      try {
        user = await this.client.users.fetch(userId);
      } catch (error) {
        log.error({ err: error }, "Failed to fetch user from Discord");
        return Err("Failed to fetch user information");
      }
    }

    if (!user) {
      return Err("User not found");
    }

    // Fetch cross-server bans
    const crossServerBansResult =
      await this.userLookupRepository.getUserCrossServerBans(userId);
    if (!crossServerBansResult.ok) {
      log.error(
        { err: crossServerBansResult.val },
        "Failed to get cross-server bans",
      );
      return Err(crossServerBansResult.val);
    }

    // Populate guild names for cross-server bans
    const crossServerBans = await Promise.all(
      crossServerBansResult.val.map(async (ban): Promise<UserLookupBan> => {
        try {
          // Fetch, not cache only -- search guilds on other shards
          const guild = await this.client.guilds.fetch(ban.guildId);
          return {
            ...ban,
            guildName: guild.name,
            guildFeatures: guild.features,
            guildMembers: guild.memberCount,
          };
        } catch {
          // Guild not found or bot not in guild anymore
          return {
            ...ban,
            guildName: null,
          };
        }
      }),
    );

    // Filter out bans where guild info couldn't be fetched
    // Note: Privacy filtering (showing/hiding names) is handled in presentation layer
    // to ensure ban counts remain accurate regardless of opt-in status
    const filteredCrossServerBans = crossServerBans.filter(
      (ban) => ban.guildName !== null,
    );

    // sort by members, largest servers first
    filteredCrossServerBans.sort((a, b) => {
      return b.guildMembers - a.guildMembers;
    });

    const result: UserLookupResult = {
      userInfo: {
        id: user.id,
        username: user.username,
        avatarURL: user.displayAvatarURL(),
        createdAt: user.createdAt,
        joinedAt: member ? member.joinedAt : null,
        isBot: user.bot,
      },
      crossServerBans: filteredCrossServerBans,
      currentGuildLookupOptIn,
    };

    log.info(
      {
        crossServerBans: filteredCrossServerBans.length,
      },
      "User lookup completed",
    );
    return Ok(result);
  }
}
