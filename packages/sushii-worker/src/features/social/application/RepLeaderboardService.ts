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
        `Failed to get rep leaderboard data for guildId ${guildId}, page ${pageIndex}`,
        { cause: error },
      );
    }
  }

  private async getUserRank(
    guildId: string,
    userId: string,
  ): Promise<number | undefined> {
    return (
      (await this.socialLeaderboardRepository.getUserRepRank(
        guildId,
        userId,
      )) ?? undefined
    );
  }

  private async getUserAmount(userId: string): Promise<bigint | undefined> {
    const userProfile =
      await this.userProfileRepository.getByIdOrDefault(userId);
    const amount = userProfile.getRep();
    return amount > 0 ? amount : undefined;
  }
}
