import type { UserProfileRepository } from "@/features/user-profile";

import type {
  SocialLeaderboardData,
  SocialLeaderboardRepository,
} from "../domain/repositories/SocialLeaderboardRepository";

export class RepLeaderboardService {
  constructor(
    private readonly socialLeaderboardRepository: SocialLeaderboardRepository,
    private readonly userProfileRepository: UserProfileRepository,
  ) {}

  async getRepLeaderboard(
    guildId: string,
    userId: string,
    pageIndex: number,
    pageSize: number,
  ): Promise<SocialLeaderboardData> {
    try {
      const [entries, totalCount, userRank, userAmount] = await Promise.all([
        this.socialLeaderboardRepository.getRepLeaderboardPage(
          guildId,
          pageIndex,
          pageSize,
        ),
        this.socialLeaderboardRepository.getRepLeaderboardCount(guildId),
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
        `Failed to get rep leaderboard data for guildId ${guildId}, page ${pageIndex}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getUserRankSafely(
    guildId: string,
    userId: string,
  ): Promise<number | undefined> {
    try {
      return (
        (await this.socialLeaderboardRepository.getUserRepRank(
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
      const amount = userProfile.getRep();
      return amount > 0 ? amount : undefined;
    } catch {
      return undefined;
    }
  }
}
