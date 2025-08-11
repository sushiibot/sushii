import dayjs from "@/shared/domain/dayjs";

import { USER_EMOJI_RATE_LIMIT_DURATION } from "../constants";
import { RateLimit } from "../entities";
import type { RateLimitRepository } from "../repositories";

export interface UsageAttempt {
  assetId: string;
}

export class RateLimitService {
  constructor(private rateLimitRepository: RateLimitRepository) {}

  /**
   * Filter usage attempts based on rate limiting rules
   * Returns only the attempts that are not rate limited
   */
  async filterRateLimitedUsage(
    userId: string,
    actionType: "message" | "reaction",
    attempts: UsageAttempt[],
  ): Promise<UsageAttempt[]> {
    if (attempts.length === 0) {
      return [];
    }

    // Validate inputs
    if (!userId || !actionType) {
      return [];
    }

    // Remove duplicate asset IDs to avoid unnecessary database calls
    const uniqueAssetIds = [...new Set(attempts.map((a) => a.assetId))];
    const uniqueAttempts = uniqueAssetIds.map((assetId) => ({ assetId }));

    if (uniqueAttempts.length === 0) {
      return [];
    }

    const rateLimitCutoff = dayjs
      .utc()
      .subtract(USER_EMOJI_RATE_LIMIT_DURATION)
      .toDate();

    // Find existing rate limits within the time window
    const activeRateLimits =
      await this.rateLimitRepository.findActiveRateLimits(
        userId,
        uniqueAssetIds,
        actionType,
        rateLimitCutoff,
      );

    const rateLimitedAssetIds = new Set(
      activeRateLimits.map((rl) => rl.assetId),
    );

    // Filter out rate limited attempts
    const eligibleAttempts = attempts.filter(
      (attempt) => !rateLimitedAssetIds.has(attempt.assetId),
    );

    return eligibleAttempts;
  }

  /**
   * Record rate limits for successful usage tracking
   */
  async recordRateLimits(
    userId: string,
    actionType: "message" | "reaction",
    assetIds: string[],
  ): Promise<void> {
    if (assetIds.length === 0) {
      return;
    }

    const now = dayjs.utc().toDate();
    const rateLimits = assetIds.map(
      (assetId) => new RateLimit(userId, assetId, actionType, now),
    );

    await this.rateLimitRepository.upsertRateLimits(rateLimits);
  }
}
