import type { Client } from "discord.js";
import type { User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { UserInfo } from "../../shared/domain/types/UserInfo";
import type { UserLookupBan } from "../domain/entities/UserLookupBan";
import type { UserLookupRepository } from "../domain/repositories/UserLookupRepository";

export interface UserLookupResult {
  userInfo: UserInfo;
  crossServerBans: UserLookupBan[];
}

export class LookupUserService {
  constructor(
    private readonly client: Client,
    private readonly userLookupRepository: UserLookupRepository,
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

    const member = guild.members.cache.get(userId);
    let user: User | null = null;

    if (member) {
      user = member.user;
    } else {
      try {
        user = await this.client.users.fetch(userId);
      } catch (error) {
        log.error({ error }, "Failed to fetch user from Discord");
        return Err(`Failed to fetch user: ${error}`);
      }
    }

    if (!user) {
      return Err("User not found");
    }

    // Fetch cross-server bans
    const crossServerBansResult = await this.userLookupRepository.getUserCrossServerBans(
      userId,
    );
    if (!crossServerBansResult.ok) {
      log.error(
        { error: crossServerBansResult.val },
        "Failed to get cross-server bans",
      );
      return Err(crossServerBansResult.val);
    }

    // Populate guild names for cross-server bans
    const crossServerBans = await Promise.all(
      crossServerBansResult.val.map(async (ban): Promise<UserLookupBan> => {
        if (!ban.guildId) {
          return {
            ...ban,
            guildName: null,
          };
        }

        try {
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

    // Filter out bans where guild info couldn't be fetched or opt-in is disabled
    const filteredCrossServerBans = crossServerBans.filter(
      (ban) => ban.guildName !== null,
    );

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
    };

    log.info({ 
      crossServerBans: filteredCrossServerBans.length 
    }, "User lookup completed");
    return Ok(result);
  }
}
