import type { LeaderboardEntry } from "../domain/entities/LeaderboardEntry";
import type { UserLevel } from "../domain/entities/UserLevel";
import type { UserRank } from "../domain/entities/UserRank";
import type { UserLevelRepository } from "../domain/repositories/UserLevelRepository";
import type { TimeFrame } from "../domain/value-objects/TimeFrame";

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  userRank?: UserRank;
  userLevel?: UserLevel;
  totalCount: number;
}

export class GetLeaderboardService {
  constructor(private readonly userLevelRepository: UserLevelRepository) {}

  async getLeaderboard(
    guildId: string,
    userId: string,
    timeframe: TimeFrame,
    pageIndex: number,
    pageSize: number,
  ): Promise<LeaderboardData> {
    try {
      const [entries, totalCount, userRank, userLevel] = await Promise.all([
        this.userLevelRepository.getLeaderboardPage(
          guildId,
          timeframe,
          pageIndex,
          pageSize,
        ),
        this.userLevelRepository.getUserCountInTimeframe(guildId, timeframe),
        this.getUserRankSafely(guildId, userId),
        this.getUserLevelSafely(guildId, userId),
      ]);

      return {
        entries,
        userRank,
        userLevel,
        totalCount,
      };
    } catch (error) {
      throw new Error(
        `Failed to get leaderboard data for guildId ${guildId}, timeframe ${timeframe}, page ${pageIndex}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async getUserRankSafely(
    guildId: string,
    userId: string,
  ): Promise<UserRank | undefined> {
    try {
      return await this.userLevelRepository.getUserGuildRankings(guildId, userId);
    } catch {
      return undefined;
    }
  }

  private async getUserLevelSafely(
    guildId: string,
    userId: string,
  ): Promise<UserLevel | undefined> {
    try {
      const level = await this.userLevelRepository.getUserGuildLevel(guildId, userId);
      return level.getAllTimeXp() > 0 ? level : undefined;
    } catch {
      return undefined;
    }
  }
}