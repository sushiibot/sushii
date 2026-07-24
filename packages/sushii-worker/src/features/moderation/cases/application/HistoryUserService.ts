import type { Client, User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { AltAccountRepository } from "@/features/alt-accounts/domain/repositories";
import type { AltIdentityWithMembers } from "@/features/alt-accounts/domain/types";

import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import type { UserInfo } from "../../shared/domain/types/UserInfo";

export interface UserHistoryResult {
  userInfo: UserInfo;
  moderationHistory: ModerationCase[];
  totalCases: number;
  /** Set when the target account is part of a tracked alt identity with other members. */
  linkedIdentity: AltIdentityWithMembers | null;
}

export class HistoryUserService {
  constructor(
    private readonly client: Client,
    private readonly modLogRepository: ModLogRepository,
    private readonly altAccountRepository: AltAccountRepository,
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

    const userFetchPromise: Promise<Result<User, string>> = member
      ? Promise.resolve(Ok(member.user))
      : this.client.users
          .fetch(userId)
          .then((fetchedUser) => Ok(fetchedUser))
          .catch((error) => {
            log.error({ err: error }, "Failed to fetch user from Discord");
            return Err(`Failed to fetch user: ${error}`);
          });

    const [userResult, identityResult] = await Promise.all([
      userFetchPromise,
      this.altAccountRepository.findIdentityByUserId(guildId, userId),
    ]);

    if (!userResult.ok) {
      return Err(userResult.val);
    }

    const user = userResult.val;

    if (!identityResult.ok) {
      log.error(
        { error: identityResult.val },
        "Failed to look up linked identity, showing single-account history",
      );
    }

    const linkedIdentity =
      identityResult.ok && identityResult.val && identityResult.val.members.length > 1
        ? identityResult.val
        : null;

    const historyUserIds = linkedIdentity
      ? linkedIdentity.members.map((m) => m.userId)
      : [userId];

    const moderationHistoryResult =
      await this.modLogRepository.findByUserIdsNotPending(
        guildId,
        historyUserIds,
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
        joinedAt: member ? member.joinedAt : null,
        isBot: user.bot,
      },
      moderationHistory: moderationHistoryResult.val,
      totalCases: moderationHistoryResult.val.length,
      linkedIdentity,
    };

    log.info(
      { totalCases: result.totalCases },
      "User history lookup completed",
    );
    return Ok(result);
  }
}
