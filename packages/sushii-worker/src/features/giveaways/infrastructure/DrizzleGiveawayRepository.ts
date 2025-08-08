import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, eq, lte, sql } from "drizzle-orm";
import type { Result } from "ts-results";
import { Ok, Err } from "ts-results";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import dayjs from "@/shared/domain/dayjs";

import type { GiveawayData } from "../domain/entities/Giveaway";
import { Giveaway } from "../domain/entities/Giveaway";
import type { GiveawayRepository } from "../domain/repositories/GiveawayRepository";

export class DrizzleGiveawayRepository implements GiveawayRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async create(
    giveaway: Giveaway,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway, string>> {
    try {
      const database = tx ?? this.db;
      const data = giveaway.toData();

      const result = await database
        .insert(schema.giveawaysInAppPublic)
        .values({
          id: BigInt(data.id),
          channelId: BigInt(data.channelId),
          guildId: BigInt(data.guildId),
          hostUserId: BigInt(data.hostUserId),
          prize: data.prize,
          numWinners: data.numWinners,
          requiredRoleId: data.requiredRoleId ? BigInt(data.requiredRoleId) : undefined,
          requiredMinLevel: data.requiredMinLevel,
          requiredMaxLevel: data.requiredMaxLevel,
          requiredNitroState: data.requiredNitroState,
          requiredBoosting: data.requiredBoosting,
          isEnded: data.isEnded,
          startAt: data.startAt.toISOString(),
          endAt: data.endAt.toISOString(),
        })
        .returning();

      if (result.length === 0) {
        return Err("Failed to create giveaway");
      }

      return Ok(this.mapToEntity(result[0]));
    } catch (err) {
      this.logger.error({ err }, "Failed to create giveaway in database");
      return Err("Database error");
    }
  }

  async findByGuildAndId(
    guildId: string,
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway | null, string>> {
    try {
      const database = tx ?? this.db;

      const result = await database
        .select()
        .from(schema.giveawaysInAppPublic)
        .where(
          and(
            eq(schema.giveawaysInAppPublic.guildId, BigInt(guildId)),
            eq(schema.giveawaysInAppPublic.id, BigInt(giveawayId)),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return Ok(null);
      }

      return Ok(this.mapToEntity(result[0]));
    } catch (err) {
      this.logger.error({ err, guildId, giveawayId }, "Failed to find giveaway");
      return Err("Database error");
    }
  }

  async findActiveByGuild(
    guildId: string,
    limit = 25,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway[], string>> {
    try {
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

      return Ok(result.map((row) => this.mapToEntity(row)));
    } catch (err) {
      this.logger.error({ err, guildId }, "Failed to find active giveaways");
      return Err("Database error");
    }
  }

  async findCompletedByGuild(
    guildId: string,
    limit = 25,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway[], string>> {
    try {
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

      return Ok(result.map((row) => this.mapToEntity(row)));
    } catch (err) {
      this.logger.error({ err, guildId }, "Failed to find completed giveaways");
      return Err("Database error");
    }
  }

  async countActiveGiveaways(
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<number, string>> {
    try {
      const database = tx ?? this.db;

      const result = await database
        .select({ count: sql<number>`count(*)` })
        .from(schema.giveawaysInAppPublic)
        .where(eq(schema.giveawaysInAppPublic.isEnded, false));

      return Ok(Number(result[0]?.count ?? 0));
    } catch (err) {
      this.logger.error({ err }, "Failed to count active giveaways");
      return Err("Database error");
    }
  }

  async findAndMarkExpiredAsEnded(
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway[], string>> {
    try {
      const database = tx ?? this.db;
      const now = dayjs.utc().toDate();

      const result = await database
        .update(schema.giveawaysInAppPublic)
        .set({ isEnded: true })
        .where(
          and(
            lte(schema.giveawaysInAppPublic.endAt, now.toISOString()),
            eq(schema.giveawaysInAppPublic.isEnded, false),
          ),
        )
        .returning();

      return Ok(result.map((row) => this.mapToEntity(row)));
    } catch (err) {
      this.logger.error({ err }, "Failed to find and mark expired giveaways");
      return Err("Database error");
    }
  }

  async update(
    giveaway: Giveaway,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway, string>> {
    try {
      const database = tx ?? this.db;
      const data = giveaway.toData();

      const result = await database
        .update(schema.giveawaysInAppPublic)
        .set({
          prize: data.prize,
          numWinners: data.numWinners,
          requiredRoleId: data.requiredRoleId ? BigInt(data.requiredRoleId) : null,
          requiredMinLevel: data.requiredMinLevel,
          requiredMaxLevel: data.requiredMaxLevel,
          requiredNitroState: data.requiredNitroState,
          requiredBoosting: data.requiredBoosting,
          isEnded: data.isEnded,
          endAt: data.endAt.toISOString(),
        })
        .where(eq(schema.giveawaysInAppPublic.id, BigInt(data.id)))
        .returning();

      if (result.length === 0) {
        return Err("Giveaway not found");
      }

      return Ok(this.mapToEntity(result[0]));
    } catch (err) {
      this.logger.error({ err }, "Failed to update giveaway");
      return Err("Database error");
    }
  }

  async markAsEnded(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway | null, string>> {
    try {
      const database = tx ?? this.db;

      const result = await database
        .update(schema.giveawaysInAppPublic)
        .set({ isEnded: true })
        .where(eq(schema.giveawaysInAppPublic.id, BigInt(giveawayId)))
        .returning();

      if (result.length === 0) {
        return Ok(null);
      }

      return Ok(this.mapToEntity(result[0]));
    } catch (err) {
      this.logger.error({ err, giveawayId }, "Failed to mark giveaway as ended");
      return Err("Database error");
    }
  }

  async delete(
    guildId: string,
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway | null, string>> {
    try {
      const database = tx ?? this.db;

      const result = await database
        .delete(schema.giveawaysInAppPublic)
        .where(
          and(
            eq(schema.giveawaysInAppPublic.guildId, BigInt(guildId)),
            eq(schema.giveawaysInAppPublic.id, BigInt(giveawayId)),
          ),
        )
        .returning();

      if (result.length === 0) {
        return Ok(null);
      }

      return Ok(this.mapToEntity(result[0]));
    } catch (err) {
      this.logger.error({ err, guildId, giveawayId }, "Failed to delete giveaway");
      return Err("Database error");
    }
  }

  private mapToEntity(row: typeof schema.giveawaysInAppPublic.$inferSelect): Giveaway {
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