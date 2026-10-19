import type { GlobalLeaderboardEntry } from "../entities/GlobalLeaderboardEntry";
import type { GlobalUserLevel } from "../entities/GlobalUserLevel";
import type { LeaderboardEntry } from "../entities/LeaderboardEntry";
import type { UserLevel } from "../entities/UserLevel";
import type { UserRank } from "../entities/UserRank";
import type { RankPosition } from "../value-objects/RankPosition";
import type { TimeFrame } from "../value-objects/TimeFrame";

export interface UserLevelRepository {
  findByUserAndGuild(
    userId: string,
    guildId: string,
  ): Promise<UserLevel | null>;
  getUserGuildLevel(guildId: string, userId: string): Promise<UserLevel>;
  getUserGlobalLevel(userId: string): Promise<GlobalUserLevel>;
  getUserGuildRankings(guildId: string, userId: string): Promise<UserRank>;
  save(userLevel: UserLevel): Promise<void>;
  /**
   * Inserts a new user level row. Returns false if the row already exists
   * (e.g. created concurrently), leaving the existing row unchanged.
   */
  create(userLevel: UserLevel): Promise<boolean>;
  getLeaderboardPage(
    guildId: string,
    timeframe: TimeFrame,
    pageIndex: number,
    pageSize: number,
  ): Promise<LeaderboardEntry[]>;
  getUserCountInTimeframe(
    guildId: string,
    timeframe: TimeFrame,
  ): Promise<number>;
  getGlobalLeaderboardPage(
    timeframe: TimeFrame,
    pageIndex: number,
    pageSize: number,
  ): Promise<GlobalLeaderboardEntry[]>;
  getGlobalUserRank(
    userId: string,
    timeframe: TimeFrame,
  ): Promise<RankPosition>;
}
