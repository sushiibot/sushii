import type { RateLimit } from "../entities";

export interface RateLimitRepository {
  /**
   * Find rate limits for user and assets within time window
   */
  findActiveRateLimits(
    userId: string,
    assetIds: string[],
    actionType: "message" | "reaction",
    since: Date,
  ): Promise<RateLimit[]>;

  /**
   * Upsert rate limit records
   */
  upsertRateLimits(rateLimits: RateLimit[]): Promise<void>;
}
