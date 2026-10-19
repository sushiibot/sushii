import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";

import type { GiveawayEntryData } from "../domain/entities/GiveawayEntry";
import { GiveawayEntry } from "../domain/entities/GiveawayEntry";
import type { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";

export class DrizzleGiveawayEntryRepository implements GiveawayEntryRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async createBatch(
    entries: GiveawayEntry[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<number> {
    if (entries.length === 0) {
      return 0;
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
      .onConflictDoNothing({
        target: [
          schema.giveawayEntriesInAppPublic.giveawayId,
          schema.giveawayEntriesInAppPublic.userId,
        ],
      });

    // Drizzle doesn't return row count from onConflict, so we return the input count
    // This is consistent with the original behavior
    return entries.length;
  }

  async findByGiveawayAndUser(
    giveawayId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<GiveawayEntry | null> {
    const database = tx ?? this.db;

    const [row] = await database
      .select()
      .from(schema.giveawayEntriesInAppPublic)
      .where(
        and(
          eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)),
          eq(schema.giveawayEntriesInAppPublic.userId, BigInt(userId)),
        ),
      )
      .limit(1);

    return row ? this.mapToEntity(row) : null;
  }

  async countByGiveaway(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<number> {
    const database = tx ?? this.db;

    const result = await database
      .select({ count: sql<number>`count(*)` })
      .from(schema.giveawayEntriesInAppPublic)
      .where(
        eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)),
      );

    // node-postgres returns bigint count(*) as a string
    return Number(result[0]?.count ?? 0);
  }

  async findRandomEntries(
    giveawayId: string,
    count: number,
    allowRepeatWinners: boolean,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<GiveawayEntry[]> {
    const database = tx ?? this.db;

    const baseCondition = eq(
      schema.giveawayEntriesInAppPublic.giveawayId,
      BigInt(giveawayId),
    );

    // If not allowing repeat winners, filter out already picked entries
    const condition = allowRepeatWinners
      ? baseCondition
      : and(
          baseCondition,
          eq(schema.giveawayEntriesInAppPublic.isPicked, false),
        );

    const result = await database
      .select()
      .from(schema.giveawayEntriesInAppPublic)
      .where(condition)
      .orderBy(sql`RANDOM()`)
      .limit(count);

    return result.map((row) => this.mapToEntity(row));
  }

  async markAsPicked(
    giveawayId: string,
    userIds: string[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const database = tx ?? this.db;

    await database
      .update(schema.giveawayEntriesInAppPublic)
      .set({ isPicked: true })
      .where(
        and(
          eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)),
          inArray(
            schema.giveawayEntriesInAppPublic.userId,
            userIds.map((id) => BigInt(id)),
          ),
        ),
      );
  }

  async delete(
    giveawayId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void> {
    const database = tx ?? this.db;

    await database
      .delete(schema.giveawayEntriesInAppPublic)
      .where(
        and(
          eq(schema.giveawayEntriesInAppPublic.giveawayId, BigInt(giveawayId)),
          eq(schema.giveawayEntriesInAppPublic.userId, BigInt(userId)),
        ),
      );
  }

  private mapToEntity(
    row: typeof schema.giveawayEntriesInAppPublic.$inferSelect,
  ): GiveawayEntry {
    const data: GiveawayEntryData = {
      giveawayId: row.giveawayId.toString(),
      userId: row.userId.toString(),
      createdAt: new Date(row.createdAt),
      isPicked: row.isPicked,
    };

    return GiveawayEntry.fromData(data);
  }
}
