import type { Client } from "discord.js";
import type { User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import type { UserInfo } from "../../shared/domain/types/UserInfo";

export interface UserHistoryResult {
  userInfo: UserInfo;
  moderationHistory: ModerationCase[];
  totalCases: number;
}

export class HistoryUserService {
  constructor(
    private readonly client: Client,
    private readonly modLogRepository: ModLogRepository,
    private readonly logger: Logger,
  ) {}

  async getUserHistory(
    guildId: string,
    userId: string,
  ): Promise<Result<UserHistoryResult, string>> {
    const log = this.logger.child({ guildId, userId });

    log.info("Getting user moderation history");

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

    const moderationHistoryResult = await this.modLogRepository.findByUserId(
      guildId,
      userId,
    );
    if (!moderationHistoryResult.ok) {
      log.error(
        { error: moderationHistoryResult.val },
        "Failed to get moderation history",
      );
      return Err(moderationHistoryResult.val);
    }

    const result: UserHistoryResult = {
      userInfo: {
        id: user.id,
        username: user.username,
        avatarURL: user.displayAvatarURL(),
        createdAt: user.createdAt,
        joinedAt: member ? member.joinedAt : null,
        isBot: user.bot,
      },
      moderationHistory: moderationHistoryResult.val,
      totalCases: moderationHistoryResult.val.length,
    };

    log.info(
      { totalCases: result.totalCases },
      "User history lookup completed",
    );
    return Ok(result);
  }
}
