import { and, eq, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";
import dayjs from "@/shared/domain/dayjs";

import type { GiveawayData } from "../domain/entities/Giveaway";
import { Giveaway } from "../domain/entities/Giveaway";
import type { GiveawayRepository } from "../domain/repositories/GiveawayRepository";

export class DrizzleGiveawayRepository implements GiveawayRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async create(
    giveaway: Giveaway,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway> {
    const database = tx ?? this.db;
    const data = giveaway.toData();

    const [row] = await database
      .insert(schema.giveawaysInAppPublic)
      .values({
        id: BigInt(data.id),
        channelId: BigInt(data.channelId),
        guildId: BigInt(data.guildId),
        hostUserId: BigInt(data.hostUserId),
        prize: data.prize,
        numWinners: data.numWinners,
        requiredRoleId: data.requiredRoleId
          ? BigInt(data.requiredRoleId)
          : undefined,
        requiredMinLevel: data.requiredMinLevel,
        requiredMaxLevel: data.requiredMaxLevel,
        requiredNitroState: data.requiredNitroState,
        requiredBoosting: data.requiredBoosting,
        isEnded: data.isEnded,
        startAt: data.startAt.toISOString(),
        endAt: data.endAt.toISOString(),
      })
      .returning();

    if (!row) {
      throw new Error("Giveaway insert returned no rows");
    }

    return this.mapToEntity(row);
  }

  async findByGuildAndId(
    guildId: string,
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null> {
    const database = tx ?? this.db;

    const [row] = await database
      .select()
      .from(schema.giveawaysInAppPublic)
      .where(
        and(
          eq(schema.giveawaysInAppPublic.guildId, BigInt(guildId)),
          eq(schema.giveawaysInAppPublic.id, BigInt(giveawayId)),
        ),
      )
      .limit(1);

    return row ? this.mapToEntity(row) : null;
  }

  async findActiveByGuild(
    guildId: string,
    limit = 25,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway[]> {
    const database = tx ?? this.db;

    const result = await database
      .select()
      .from(schema.giveawaysInAppPublic)
      .where(
        and(
          eq(schema.giveawaysInAppPublic.guildId, BigInt(guildId)),
          eq(schema.giveawaysInAppPublic.isEnded, false),
        ),
      )
      .orderBy(schema.giveawaysInAppPublic.endAt)
      .limit(limit);

    return result.map((row) => this.mapToEntity(row));
  }

  async findCompletedByGuild(
    guildId: string,
    limit = 25,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway[]> {
    const database = tx ?? this.db;

    const result = await database
      .select()
      .from(schema.giveawaysInAppPublic)
      .where(
        and(
          eq(schema.giveawaysInAppPublic.guildId, BigInt(guildId)),
          eq(schema.giveawaysInAppPublic.isEnded, true),
        ),
      )
      .orderBy(schema.giveawaysInAppPublic.endAt)
      .limit(limit);

    return result.map((row) => this.mapToEntity(row));
  }

  async countActiveGiveaways(
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<number> {
    const database = tx ?? this.db;

    const result = await database
      .select({ count: sql<number>`count(*)` })
      .from(schema.giveawaysInAppPublic)
      .where(eq(schema.giveawaysInAppPublic.isEnded, false));

    return Number(result[0]?.count ?? 0);
  }

  async findExpired(tx?: NodePgDatabase<typeof schema>): Promise<Giveaway[]> {
    const database = tx ?? this.db;
    const now = dayjs.utc().toDate();

    const result = await database
      .select()
      .from(schema.giveawaysInAppPublic)
      .where(
        and(
          lte(schema.giveawaysInAppPublic.endAt, now.toISOString()),
          eq(schema.giveawaysInAppPublic.isEnded, false),
        ),
      )
      .orderBy(schema.giveawaysInAppPublic.endAt);

    return result.map((row) => this.mapToEntity(row));
  }

  async claimForEnding(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null> {
    const database = tx ?? this.db;

    const [row] = await database
      .update(schema.giveawaysInAppPublic)
      .set({ isEnded: true })
      .where(
        and(
          eq(schema.giveawaysInAppPublic.id, BigInt(giveawayId)),
          eq(schema.giveawaysInAppPublic.isEnded, false),
        ),
      )
      .returning();

    return row ? this.mapToEntity(row) : null;
  }

  async releaseEndingClaim(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void> {
    const database = tx ?? this.db;

    await database
      .update(schema.giveawaysInAppPublic)
      .set({ isEnded: false })
      .where(eq(schema.giveawaysInAppPublic.id, BigInt(giveawayId)));
  }

  async update(
    giveaway: Giveaway,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null> {
    const database = tx ?? this.db;
    const data = giveaway.toData();

    const [row] = await database
      .update(schema.giveawaysInAppPublic)
      .set({
        prize: data.prize,
        numWinners: data.numWinners,
        requiredRoleId: data.requiredRoleId
          ? BigInt(data.requiredRoleId)
          : null,
        requiredMinLevel: data.requiredMinLevel,
        requiredMaxLevel: data.requiredMaxLevel,
        requiredNitroState: data.requiredNitroState,
        requiredBoosting: data.requiredBoosting,
        isEnded: data.isEnded,
        endAt: data.endAt.toISOString(),
      })
      .where(eq(schema.giveawaysInAppPublic.id, BigInt(data.id)))
      .returning();

    return row ? this.mapToEntity(row) : null;
  }

  async markAsEnded(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null> {
    const database = tx ?? this.db;

    const [row] = await database
      .update(schema.giveawaysInAppPublic)
      .set({ isEnded: true })
      .where(eq(schema.giveawaysInAppPublic.id, BigInt(giveawayId)))
      .returning();

    return row ? this.mapToEntity(row) : null;
  }

  async delete(
    guildId: string,
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null> {
    const database = tx ?? this.db;

    const [row] = await database
      .delete(schema.giveawaysInAppPublic)
      .where(
        and(
          eq(schema.giveawaysInAppPublic.guildId, BigInt(guildId)),
          eq(schema.giveawaysInAppPublic.id, BigInt(giveawayId)),
        ),
      )
      .returning();

    return row ? this.mapToEntity(row) : null;
  }

  private mapToEntity(
    row: typeof schema.giveawaysInAppPublic.$inferSelect,
  ): Giveaway {
    const data: GiveawayData = {
      id: row.id.toString(),
      channelId: row.channelId.toString(),
      guildId: row.guildId.toString(),
      hostUserId: row.hostUserId.toString(),
      prize: row.prize,
      numWinners: row.numWinners,
      requiredRoleId: row.requiredRoleId?.toString(),
      requiredMinLevel: row.requiredMinLevel ?? undefined,
      requiredMaxLevel: row.requiredMaxLevel ?? undefined,
      requiredNitroState: row.requiredNitroState ?? undefined,
      requiredBoosting: row.requiredBoosting ?? undefined,
      isEnded: row.isEnded,
      startAt: new Date(row.startAt),
      endAt: new Date(row.endAt),
    };

    return Giveaway.fromData(data);
  }
}
