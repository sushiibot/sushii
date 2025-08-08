import type { Client } from "discord.js";
import type { User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModerationCaseRepository } from "../../shared/domain/repositories/ModerationCaseRepository";
import type { UserInfo } from "../../shared/domain/types/UserInfo";

export interface UserLookupResult {
  userInfo: UserInfo;
  moderationHistory: ModerationCase[];
  totalCases: number;
}

export class LookupUserService {
  constructor(
    private readonly client: Client,
    private readonly caseRepository: ModerationCaseRepository,
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

    const moderationHistoryResult = await this.caseRepository.findByUserId(
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

    const result: UserLookupResult = {
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

    log.info({ totalCases: result.totalCases }, "User lookup completed");
    return Ok(result);
  }
}
