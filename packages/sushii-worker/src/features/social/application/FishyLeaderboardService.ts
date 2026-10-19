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
        this.getUserRank(guildId, userId),
        this.getUserAmount(userId),
      ]);

      return {
        entries,
        userRank,
        userAmount,
        totalCount,
      };
    } catch (error) {
      throw new Error(
        `Failed to get fishy leaderboard data for guildId ${guildId}, page ${pageIndex}`,
        { cause: error },
      );
    }
  }

  private async getUserRank(
    guildId: string,
    userId: string,
  ): Promise<number | undefined> {
    return (
      (await this.socialLeaderboardRepository.getUserFishyRank(
        guildId,
        userId,
      )) ?? undefined
    );
  }

  private async getUserAmount(userId: string): Promise<bigint | undefined> {
    const userProfile =
      await this.userProfileRepository.getByIdOrDefault(userId);
    const amount = userProfile.getFishies();
    return amount > 0 ? amount : undefined;
  }
}
