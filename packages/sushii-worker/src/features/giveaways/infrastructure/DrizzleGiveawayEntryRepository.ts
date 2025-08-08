import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Result } from "ts-results";
import { Ok, Err } from "ts-results";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";

import type { GiveawayEntryData } from "../domain/entities/GiveawayEntry";
import { GiveawayEntry } from "../domain/entities/GiveawayEntry";
import type { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";

export class DrizzleGiveawayEntryRepository implements GiveawayEntryRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async createBatch(
    entries: GiveawayEntry[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<number, string>> {
    try {
      if (entries.length === 0) {
        return Ok(0);
      }

      const database = tx ?? this.db;

      const values = entries.map((entry) => {
        const data = entry.toData();
        return {
          giveawayId: BigInt(data.giveawayId),
          userId: BigInt(data.userId),
          createdAt: data.createdAt.toISOString(),
          isPicked: data.isPicked,
        };
      });

      await database
        .insert(schema.giveawayEntriesInAppPublic)
        .values(values)
        .onConflictDoNothing({ target: [schema.giveawayEntriesInAppPublic.giveawayId, schema.giveawayEntriesInAppPublic.userId] });

      // Drizzle doesn't return row count from onConflict, so we return the input count
      // This is consistent with the original behavior
      return Ok(entries.length);
    } catch (err) {
      this.logger.error({ err, entriesCount: entries.length }, "Failed to create giveaway entries");
      return Err("Database error");
    }
  }

  async findByGiveawayAndUser(
    giveawayId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<GiveawayEntry | null, string>> {
    try {
      const database = tx ?? this.db;

      const result = await database
        .select()
        .from(schema.giveawayEntriesInAppPublic)
        .where(
          and(
            eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)),
            eq(schema.giveawayEntriesInAppPublic.userId, BigInt(userId)),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return Ok(null);
      }

      return Ok(this.mapToEntity(result[0]));
    } catch (err) {
      this.logger.error({ err, giveawayId, userId }, "Failed to find giveaway entry");
      return Err("Database error");
    }
  }

  async countByGiveaway(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<number, string>> {
    try {
      const database = tx ?? this.db;

      const result = await database
        .select({ count: sql<number>`count(*)` })
        .from(schema.giveawayEntriesInAppPublic)
        .where(eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)));

      return Ok(result[0]?.count ?? 0);
    } catch (err) {
      this.logger.error({ err, giveawayId }, "Failed to count giveaway entries");
      return Err("Database error");
    }
  }

  async findRandomEntries(
    giveawayId: string,
    count: number,
    allowRepeatWinners: boolean,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<GiveawayEntry[], string>> {
    try {
      const database = tx ?? this.db;

      let query = database
        .select()
        .from(schema.giveawayEntriesInAppPublic)
        .where(eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)))
        .orderBy(sql`RANDOM()`)
        .limit(count);

      // If not allowing repeat winners, filter out already picked entries
      if (!allowRepeatWinners) {
        const baseCondition = eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId));
        const pickedCondition = eq(schema.giveawayEntriesInAppPublic.isPicked, false);
        
        query = database
          .select()
          .from(schema.giveawayEntriesInAppPublic)
          .where(and(baseCondition, pickedCondition))
          .orderBy(sql`RANDOM()`)
          .limit(count);
      }

      const result = await query;

      return Ok(result.map((row) => this.mapToEntity(row)));
    } catch (err) {
      this.logger.error(
        { err, giveawayId, count, allowRepeatWinners },
        "Failed to find random giveaway entries",
      );
      return Err("Database error");
    }
  }

  async markAsPicked(
    giveawayId: string,
    userIds: string[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    try {
      if (userIds.length === 0) {
        return Ok(undefined);
      }

      const database = tx ?? this.db;

      await database
        .update(schema.giveawayEntriesInAppPublic)
        .set({ isPicked: true })
        .where(
          and(
            eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)),
            inArray(schema.giveawayEntriesInAppPublic.userId, userIds.map(id => BigInt(id))),
          ),
        );

      return Ok(undefined);
    } catch (err) {
      this.logger.error(
        { err, giveawayId, userIds },
        "Failed to mark giveaway entries as picked",
      );
      return Err("Database error");
    }
  }

  async delete(
    giveawayId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    try {
      const database = tx ?? this.db;

      await database
        .delete(schema.giveawayEntriesInAppPublic)
        .where(
          and(
            eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)),
            eq(schema.giveawayEntriesInAppPublic.userId, BigInt(userId)),
          ),
        );

      return Ok(undefined);
    } catch (err) {
      this.logger.error({ err, giveawayId, userId }, "Failed to delete giveaway entry");
      return Err("Database error");
    }
  }

  private mapToEntity(row: typeof schema.giveawayEntriesInAppPublic.$inferSelect): GiveawayEntry {
    const data: GiveawayEntryData = {
      giveawayId: row.giveawayId.toString(),
      userId: row.userId.toString(),
      createdAt: new Date(row.createdAt),
      isPicked: row.isPicked,
    };

    return GiveawayEntry.fromData(data);
  }
}