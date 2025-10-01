import type { UserProfileRepository } from "@/features/user-profile";

import type {
  SocialLeaderboardData,
  SocialLeaderboardRepository,
} from "../domain/repositories/SocialLeaderboardRepository";

export class FishyLeaderboardService {
  constructor(
    private readonly socialLeaderboardRepository: SocialLeaderboardRepository,
    private readonly userProfileRepository: UserProfileRepository,
  ) {}

  async getFishyLeaderboard(
    guildId: string,
    userId: string,
    pageIndex: number,
    pageSize: number,
  ): Promise<SocialLeaderboardData> {
    try {
      const [entries, totalCount, userRank, userAmount] = await Promise.all([
        this.socialLeaderboardRepository.getFishyLeaderboardPage(
          guildId,
          pageIndex,
          pageSize,
        ),
        this.socialLeaderboardRepository.getFishyLeaderboardCount(guildId),
        this.getUserRankSafely(guildId, userId),
        this.getUserAmountSafely(guildId, userId),
      ]);

      return {
        entries,
        userRank,
        userAmount,
        totalCount,
      };
    } catch (error) {
      throw new Error(
        `Failed to get fishy leaderboard data for guildId ${guildId}, page ${pageIndex}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getUserRankSafely(
    guildId: string,
    userId: string,
  ): Promise<number | undefined> {
    try {
      return (
        (await this.socialLeaderboardRepository.getUserFishyRank(
          guildId,
          userId,
        )) ?? undefined
      );
    } catch {
      return undefined;
    }
  }

  private async getUserAmountSafely(
    guildId: string,
    userId: string,
  ): Promise<bigint | undefined> {
    try {
      const userProfile =
        await this.userProfileRepository.getByIdOrDefault(userId);
      const amount = userProfile.getFishies();
      return amount > 0 ? amount : undefined;
    } catch {
      return undefined;
    }
  }
}
