import type { GlobalLeaderboardEntry } from "../domain/entities/GlobalLeaderboardEntry";
import type { UserLevelRepository } from "../domain/repositories/UserLevelRepository";
import type { RankPosition } from "../domain/value-objects/RankPosition";
import type { TimeFrame } from "../domain/value-objects/TimeFrame";

export interface GlobalLeaderboardData {
  entries: GlobalLeaderboardEntry[];
  totalCount: number;
  userRank: RankPosition;
}

export class GetGlobalLeaderboardService {
  constructor(private readonly userLevelRepository: UserLevelRepository) {}

  async getGlobalLeaderboard(
    userId: string,
    timeframe: TimeFrame,
    pageIndex: number,
    pageSize: number,
  ): Promise<GlobalLeaderboardData> {
    const [entries, userRank] = await Promise.all([
      this.userLevelRepository.getGlobalLeaderboardPage(
        timeframe,
        pageIndex,
        pageSize,
      ),
      this.userLevelRepository.getGlobalUserRank(userId, timeframe),
    ]);

    const totalCount = userRank.getTotalCount();

    return {
      entries,
      totalCount,
      userRank,
    };
  }
}
