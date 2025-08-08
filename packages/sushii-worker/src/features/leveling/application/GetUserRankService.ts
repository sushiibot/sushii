import type { User } from "discord.js";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { GlobalUserLevel } from "../domain/entities/GlobalUserLevel";
import type { UserLevel } from "../domain/entities/UserLevel";
import type { UserProfile } from "../domain/entities/UserProfile";
import type { UserRank } from "../domain/entities/UserRank";
import type { UserLevelRepository } from "../domain/repositories/UserLevelRepository";
import type { UserProfileRepository } from "../domain/repositories/UserProfileRepository";

export interface UserRankData {
  user: User;
  profile: UserProfile;
  guildLevel: UserLevel;
  globalLevel: GlobalUserLevel;
  rankings: UserRank;
}

export class GetUserRankService {
  constructor(
    private readonly userProfileRepository: UserProfileRepository,
    private readonly userLevelRepository: UserLevelRepository,
  ) {}

  async execute(
    user: User,
    guildId: string,
  ): Promise<Result<UserRankData, string>> {
    try {
      const [profile, guildLevel, globalLevel, rankings] = await Promise.all([
        this.userProfileRepository.getUserProfile(user.id),
        this.userLevelRepository.getUserGuildLevel(guildId, user.id),
        this.userLevelRepository.getUserGlobalLevel(user.id),
        this.userLevelRepository.getUserGuildRankings(guildId, user.id),
      ]);

      return Ok({
        user,
        profile,
        guildLevel,
        globalLevel,
        rankings,
      });
    } catch (error) {
      return Err(`Failed to get user rank data: ${error}`);
    }
  }
}
