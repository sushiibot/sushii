import type { GuildMember } from "discord.js";
import type { Result } from "ts-results";
import { Ok, Err } from "ts-results";
import type { Logger } from "pino";

import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";

import type { Giveaway, GiveawayEligibility } from "../domain/entities/Giveaway";

export class GiveawayEligibilityService {
  constructor(
    private readonly userLevelRepository: UserLevelRepository,
    private readonly logger: Logger,
  ) {}

  async checkEligibility(
    giveaway: Giveaway,
    member: GuildMember,
  ): Promise<Result<GiveawayEligibility, string>> {
    try {
      this.logger.debug(
        { giveawayId: giveaway.id, userId: member.id },
        "Checking giveaway eligibility",
      );

      // Get user level if level requirements exist
      let userLevel = 0;
      if (giveaway.requiredMinLevel || giveaway.requiredMaxLevel) {
        const guildLevel = await this.userLevelRepository.getUserGuildLevel(
          giveaway.guildId,
          member.id,
        );
        userLevel = guildLevel.getCurrentLevel();
      }

      const eligibility = giveaway.checkEligibility(member, userLevel);

      this.logger.debug(
        {
          giveawayId: giveaway.id,
          userId: member.id,
          eligible: eligibility.eligible,
          userLevel,
        },
        "Eligibility check completed",
      );

      return Ok(eligibility);
    } catch (err) {
      this.logger.error(
        { err, giveawayId: giveaway.id, userId: member.id },
        "Failed to check giveaway eligibility",
      );
      return Err("Failed to check eligibility");
    }
  }
}