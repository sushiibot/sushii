import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import { botStatsInAppPublic } from "@/infrastructure/database/schema";

import type { StatName } from "../domain/StatName";
import type {
  BotStat,
  StatsRepository,
} from "../domain/repositories/StatsRepository";

export class DrizzleStatsRepository implements StatsRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async setStat(
    name: StatName,
    category: string,
    count: number,
  ): Promise<void> {
    try {
      await this.db
        .insert(botStatsInAppPublic)
        .values({
          name,
          category,
          count: BigInt(count),
        })
        .onConflictDoUpdate({
          target: [botStatsInAppPublic.name, botStatsInAppPublic.category],
          set: {
            count: BigInt(count),
          },
        });

      this.logger.debug({ name, category, count }, "Successfully set stat");
    } catch (error) {
      this.logger.error(
        { err: error, name, category, count },
        "Failed to set stat",
      );
      throw new Error("Failed to update bot statistics", { cause: error });
    }
  }

  async incrementStat(
    name: StatName,
    category: string,
    count: number,
  ): Promise<void> {
    try {
      await this.db
        .insert(botStatsInAppPublic)
        .values({
          name,
          category,
          count: BigInt(count),
        })
        .onConflictDoUpdate({
          target: [botStatsInAppPublic.name, botStatsInAppPublic.category],
          set: {
            count: sql`${botStatsInAppPublic.count} + ${BigInt(count)}`,
          },
        });

      this.logger.debug(
        { name, category, count },
        "Successfully incremented stat",
      );
    } catch (error) {
      this.logger.error(
        { err: error, name, category, count },
        "Failed to increment stat",
      );
      throw new Error("Failed to increment bot statistics", { cause: error });
    }
  }

  async getAllStats(): Promise<BotStat[]> {
    try {
      const result = await this.db
        .select({
          name: botStatsInAppPublic.name,
          category: botStatsInAppPublic.category,
          count: botStatsInAppPublic.count,
        })
        .from(botStatsInAppPublic);

      const stats = result.map((row) => ({
        name: row.name as StatName,
        category: row.category,
        count: row.count,
      }));

      this.logger.debug(
        { count: stats.length },
        "Successfully retrieved stats",
      );
      return stats;
    } catch (error) {
      this.logger.error({ err: error }, "Failed to retrieve stats");
      throw new Error("Failed to retrieve bot statistics", { cause: error });
    }
  }
}
