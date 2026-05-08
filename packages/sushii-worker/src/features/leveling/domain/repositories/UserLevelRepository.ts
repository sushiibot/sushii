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
  create(userLevel: UserLevel): Promise<void>;
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
