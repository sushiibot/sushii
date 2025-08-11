export interface StatsQueryOptions {
  guildId: string;
  assetType?: "emoji" | "sticker" | "both";
  actionType?: "message" | "reaction" | "sum";
  serverUsage?: "internal" | "external" | "sum";
  order?: "high_to_low" | "low_to_high";
  emojiType?: "animated" | "static" | "both";
  limit?: number;
  offset?: number;
}

export interface PaginatedStatsResult {
  results: StatsResult[];
  totalCount: number;
  hasMore: boolean;
}

export interface StatsResult {
  assetId: string;
  name: string;
  type: "emoji" | "sticker";
  totalCount: number;
}

export interface UsageData {
  guildId: string;
  assetId: string;
  count: number;
  countExternal: number;
}

export interface EmojiStickerStatsRepository {
  /**
   * Increment usage counts for assets
   */
  incrementUsage(
    actionType: "message" | "reaction",
    usageData: UsageData[],
  ): Promise<void>;

  /**
   * Query stats with filtering and sorting (paginated)
   */
  queryStats(options: StatsQueryOptions): Promise<PaginatedStatsResult>;

  /**
   * Get total count of stats for pagination
   */
  getStatsCount(
    options: Omit<StatsQueryOptions, "limit" | "offset">,
  ): Promise<number>;
}
