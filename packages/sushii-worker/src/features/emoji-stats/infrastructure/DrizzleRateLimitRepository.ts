import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { emojiStickerStatsRateLimitsInAppPublic } from "@/infrastructure/database/schema";

import { RateLimit } from "../domain/entities";
import type { RateLimitRepository } from "../domain/repositories";

export class DrizzleRateLimitRepository implements RateLimitRepository {
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async findActiveRateLimits(
    userId: string,
    assetIds: string[],
    actionType: "message" | "reaction",
    since: Date,
  ): Promise<RateLimit[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const results = await this.db
      .select()
      .from(emojiStickerStatsRateLimitsInAppPublic)
      .where(
        and(
          eq(emojiStickerStatsRateLimitsInAppPublic.userId, BigInt(userId)),
          eq(emojiStickerStatsRateLimitsInAppPublic.actionType, actionType),
          inArray(
            emojiStickerStatsRateLimitsInAppPublic.assetId,
            assetIds.map((id) => BigInt(id)),
          ),
          gte(
            emojiStickerStatsRateLimitsInAppPublic.lastUsed,
            since.toISOString(),
          ),
        ),
      );

    return results.map(
      (row) =>
        new RateLimit(
          row.userId.toString(),
          row.assetId.toString(),
          row.actionType,
          new Date(row.lastUsed),
        ),
    );
  }

  async upsertRateLimits(rateLimits: RateLimit[]): Promise<void> {
    if (rateLimits.length === 0) {
      return;
    }

    const values = rateLimits.map((rl) => ({
      userId: BigInt(rl.userId),
      assetId: BigInt(rl.assetId),
      actionType: rl.actionType,
      lastUsed: rl.lastUsed.toISOString(),
    }));

    await this.db
      .insert(emojiStickerStatsRateLimitsInAppPublic)
      .values(values)
      .onConflictDoUpdate({
        target: [
          emojiStickerStatsRateLimitsInAppPublic.userId,
          emojiStickerStatsRateLimitsInAppPublic.assetId,
          emojiStickerStatsRateLimitsInAppPublic.actionType,
        ],
        set: {
          lastUsed: sql`excluded.last_used`,
        },
      });
  }

  async deleteExpiredRateLimits(cutoffDate: Date): Promise<number> {
    const result = await this.db
      .delete(emojiStickerStatsRateLimitsInAppPublic)
      .where(
        lt(
          emojiStickerStatsRateLimitsInAppPublic.lastUsed,
          cutoffDate.toISOString(),
        ),
      );

    return result.rowCount || 0;
  }
}
