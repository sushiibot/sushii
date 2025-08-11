import { and, asc, count, desc, eq, sql, sum } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  emojiStickerStatsInAppPublic,
  guildEmojisAndStickersInAppPublic,
} from "@/infrastructure/database/schema";
import dayjs from "@/shared/domain/dayjs";

import type {
  EmojiStickerStatsRepository,
  PaginatedStatsResult,
  StatsQueryOptions,
  StatsResult,
  UsageData,
} from "../domain/repositories";

export class DrizzleEmojiStickerStatsRepository
  implements EmojiStickerStatsRepository
{
  constructor(private db: NodePgDatabase<typeof schema>) {}

  async incrementUsage(
    actionType: "message" | "reaction",
    usageData: UsageData[],
  ): Promise<void> {
    if (usageData.length === 0) {
      return;
    }

    const values = usageData.map((data) => ({
      time: dayjs.utc().startOf("day").toDate().toISOString(),
      guildId: BigInt(data.guildId),
      assetId: BigInt(data.assetId),
      actionType,
      count: BigInt(data.count),
      countExternal: BigInt(data.countExternal),
    }));

    await this.db
      .insert(emojiStickerStatsInAppPublic)
      .values(values)
      .onConflictDoUpdate({
        target: [
          emojiStickerStatsInAppPublic.time,
          emojiStickerStatsInAppPublic.assetId,
          emojiStickerStatsInAppPublic.actionType,
        ],
        set: {
          count: sql`${emojiStickerStatsInAppPublic.count} + excluded.count`,
          countExternal: sql`${emojiStickerStatsInAppPublic.countExternal} + excluded.count_external`,
        },
      });
  }

  async queryStats(options: StatsQueryOptions): Promise<PaginatedStatsResult> {
    const {
      guildId,
      assetType = "emoji",
      actionType = "sum",
      serverUsage = "internal",
      order = "high_to_low",
      limit = 25,
      offset = 0,
    } = options;

    // Build conditions array
    const conditions = this.buildConditions(guildId, assetType, actionType);

    // Build the total count expression
    const countExpression = this.buildCountExpression(serverUsage);

    // Build the main query
    const query = this.db
      .select({
        assetId: emojiStickerStatsInAppPublic.assetId,
        name: guildEmojisAndStickersInAppPublic.name,
        type: guildEmojisAndStickersInAppPublic.type,
        totalCount: countExpression,
      })
      .from(emojiStickerStatsInAppPublic)
      .innerJoin(
        guildEmojisAndStickersInAppPublic,
        eq(
          emojiStickerStatsInAppPublic.assetId,
          guildEmojisAndStickersInAppPublic.id,
        ),
      )
      .where(and(...conditions))
      .groupBy(
        emojiStickerStatsInAppPublic.assetId,
        guildEmojisAndStickersInAppPublic.type,
        guildEmojisAndStickersInAppPublic.name,
      )
      .orderBy(
        order === "high_to_low" ? desc(countExpression) : asc(countExpression),
        emojiStickerStatsInAppPublic.assetId,
      )
      .limit(limit)
      .offset(offset);

    // Execute query and get total count
    const [results, totalCount] = await Promise.all([
      query,
      this.getStatsCount({
        guildId,
        assetType,
        actionType,
        serverUsage,
        order,
      }),
    ]);

    const mappedResults: StatsResult[] = results.map((row) => ({
      assetId: row.assetId.toString(),
      name: row.name,
      type: row.type,
      totalCount: Number(row.totalCount || 0),
    }));

    return {
      results: mappedResults,
      totalCount,
      hasMore: offset + results.length < totalCount,
    };
  }

  async getStatsCount(
    options: Omit<StatsQueryOptions, "limit" | "offset">,
  ): Promise<number> {
    const {
      guildId,
      assetType = "emoji",
      actionType = "sum",
      serverUsage = "internal",
    } = options;

    // Build conditions array
    const conditions = this.buildConditions(guildId, assetType, actionType);

    // Build count query - count distinct assets that have stats
    const countQuery = this.db
      .select({
        count: sql<number>`COUNT(DISTINCT ${emojiStickerStatsInAppPublic.assetId})`,
      })
      .from(emojiStickerStatsInAppPublic)
      .innerJoin(
        guildEmojisAndStickersInAppPublic,
        eq(
          emojiStickerStatsInAppPublic.assetId,
          guildEmojisAndStickersInAppPublic.id,
        ),
      )
      .where(and(...conditions));

    // Add having clause to filter out zero counts
    const havingCondition = this.buildHavingCondition(serverUsage);
    const finalQuery = this.db
      .select({
        count: sql<number>`COUNT(*)`,
      })
      .from(
        this.db
          .select({
            assetId: emojiStickerStatsInAppPublic.assetId,
            totalCount: this.buildCountExpression(serverUsage),
          })
          .from(emojiStickerStatsInAppPublic)
          .innerJoin(
            guildEmojisAndStickersInAppPublic,
            eq(
              emojiStickerStatsInAppPublic.assetId,
              guildEmojisAndStickersInAppPublic.id,
            ),
          )
          .where(and(...conditions))
          .groupBy(emojiStickerStatsInAppPublic.assetId)
          .having(havingCondition)
          .as("stats_with_counts"),
      );

    const result = await finalQuery;
    return result[0]?.count || 0;
  }

  private buildConditions(
    guildId: string,
    assetType: string,
    actionType: string,
  ) {
    const conditions = [
      eq(guildEmojisAndStickersInAppPublic.guildId, BigInt(guildId)),
    ];

    // Add asset type filter
    if (assetType === "emoji") {
      conditions.push(eq(guildEmojisAndStickersInAppPublic.type, "emoji"));
    } else if (assetType === "sticker") {
      conditions.push(eq(guildEmojisAndStickersInAppPublic.type, "sticker"));
    }

    // Add action type filter
    if (actionType === "message") {
      conditions.push(eq(emojiStickerStatsInAppPublic.actionType, "message"));
    } else if (actionType === "reaction") {
      conditions.push(eq(emojiStickerStatsInAppPublic.actionType, "reaction"));
    }

    return conditions;
  }

  private buildCountExpression(serverUsage: string) {
    switch (serverUsage) {
      case "internal":
        return sum(emojiStickerStatsInAppPublic.count).as("total_count");
      case "external":
        return sum(emojiStickerStatsInAppPublic.countExternal).as(
          "total_count",
        );
      case "sum":
      default:
        return sql<number>`(${sum(emojiStickerStatsInAppPublic.count)} + ${sum(emojiStickerStatsInAppPublic.countExternal)})`.as(
          "total_count",
        );
    }
  }

  private buildHavingCondition(serverUsage: string) {
    switch (serverUsage) {
      case "internal":
        return sql`${sum(emojiStickerStatsInAppPublic.count)} > 0`;
      case "external":
        return sql`${sum(emojiStickerStatsInAppPublic.countExternal)} > 0`;
      case "sum":
      default:
        return sql`(${sum(emojiStickerStatsInAppPublic.count)} + ${sum(emojiStickerStatsInAppPublic.countExternal)}) > 0`;
    }
  }
}
