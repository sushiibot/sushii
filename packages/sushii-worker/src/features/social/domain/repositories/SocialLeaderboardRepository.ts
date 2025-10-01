import type { SocialLeaderboardEntry } from "../entities/SocialLeaderboardEntry";

export interface SocialLeaderboardData {
  entries: SocialLeaderboardEntry[];
  userRank?: number;
  userAmount?: bigint;
  totalCount: number;
}

export interface SocialLeaderboardRepository {
  getRepLeaderboardPage(
    guildId: string,
    pageIndex: number,
    pageSize: number,
  ): Promise<SocialLeaderboardEntry[]>;

  getFishyLeaderboardPage(
    guildId: string,
    pageIndex: number,
    pageSize: number,
  ): Promise<SocialLeaderboardEntry[]>;

  getUserRepRank(guildId: string, userId: string): Promise<number | null>;

  getUserFishyRank(guildId: string, userId: string): Promise<number | null>;

  getRepLeaderboardCount(guildId: string): Promise<number>;

  getFishyLeaderboardCount(guildId: string): Promise<number>;
}