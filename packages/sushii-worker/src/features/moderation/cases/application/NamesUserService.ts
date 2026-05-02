import type { Client, User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { UserNameHistoryEntry } from "@/features/user-name-history";
import { UserNameHistoryService } from "@/features/user-name-history";

import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import type { UserInfo } from "../../shared/domain/types/UserInfo";

export interface NamesResult {
  userInfo: UserInfo;
  history: UserNameHistoryEntry[];
  eligibilityDenied: boolean;
}

export class NamesUserService {
  constructor(
    private readonly client: Client,
    private readonly nameHistoryService: UserNameHistoryService,
    private readonly modLogRepository: ModLogRepository,
    private readonly logger: Logger,
  ) {}

  async getNames(
    guildId: string,
    userId: string,
  ): Promise<Result<NamesResult, string>> {
    const log = this.logger.child({ guildId, userId });

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return Err("Guild not found");
    }

    const member = guild.members.cache.get(userId);
    let user: User | null;

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

    const userInfo: UserInfo = {
      id: user.id,
      username: user.username,
      avatarURL: user.displayAvatarURL(),
      joinedAt: member ? member.joinedAt : null,
      isBot: user.bot,
    };

    // Eligibility check: user must be a current member OR have a mod record in this guild.
    // This prevents arbitrary server owners from looking up anyone via mod-level access.
    const isCurrentMember = member !== undefined;
    if (!isCurrentMember) {
      const hasModRecord = await this.modLogRepository.hasAnyForGuild(
        guildId,
        userId,
      );
      if (!hasModRecord) {
        log.info("Name history lookup denied - no moderation relationship");
        return Ok({ userInfo, history: [], eligibilityDenied: true });
      }
    }

    const history = await this.nameHistoryService.getHistory(userId);

    log.info({ historyCount: history.length }, "Name history lookup completed");

    return Ok({ userInfo, history, eligibilityDenied: false });
  }
}
