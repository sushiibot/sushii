import { and, eq, lte } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";
import { Err, Ok, Result } from "ts-results";

import * as schema from "@/infrastructure/database/schema";
import { tempBansInAppPublic } from "@/infrastructure/database/schema";
import dayjs from "@/shared/domain/dayjs";

import { TempBan } from "../../domain/entities/TempBan";
import { TempBanRepository } from "../../domain/repositories/TempBanRepository";

export class DrizzleTempBanRepository implements TempBanRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async save(
    tempBan: TempBan,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    try {
      await db
        .insert(tempBansInAppPublic)
        .values({
          userId: BigInt(tempBan.userId),
          guildId: BigInt(tempBan.guildId),
          expiresAt: tempBan.expiresAt.toISOString(),
          createdAt: tempBan.createdAt.toISOString(),
        })
        .onConflictDoUpdate({
          target: [tempBansInAppPublic.userId, tempBansInAppPublic.guildId],
          set: {
            expiresAt: tempBan.expiresAt.toISOString(),
          },
        });

      this.logger.debug(
        {
          userId: tempBan.userId,
          guildId: tempBan.guildId,
          expiresAt: tempBan.expiresAt.toISOString(),
        },
        "Saved temp ban",
      );

      return Ok.EMPTY;
    } catch (err) {
      this.logger.error({ err }, "Failed to save temp ban");
      return Err(`Failed to save temp ban: ${err}`);
    }
  }

  async delete(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<TempBan | null, string>> {
    const db = tx || this.db;
    try {
      const result = await db
        .delete(tempBansInAppPublic)
        .where(
          and(
            eq(tempBansInAppPublic.guildId, BigInt(guildId)),
            eq(tempBansInAppPublic.userId, BigInt(userId)),
          ),
        )
        .returning();

      if (result.length === 0) {
        return Ok(null);
      }

      const row = result[0];
      const tempBan = TempBan.fromDatabase(
        row.userId.toString(),
        row.guildId.toString(),
        row.expiresAt,
        row.createdAt,
      );

      this.logger.debug(
        {
          userId,
          guildId,
        },
        "Deleted temp ban",
      );

      return Ok(tempBan);
    } catch (err) {
      this.logger.error({ err, guildId, userId }, "Failed to delete temp ban");
      return Err(`Failed to delete temp ban: ${err}`);
    }
  }

  async findByGuildId(
    guildId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<TempBan[], string>> {
    const db = tx || this.db;
    try {
      const results = await db
        .select()
        .from(tempBansInAppPublic)
        .where(eq(tempBansInAppPublic.guildId, BigInt(guildId)));

      const tempBans = results.map((row) =>
        TempBan.fromDatabase(
          row.userId.toString(),
          row.guildId.toString(),
          row.expiresAt,
          row.createdAt,
        ),
      );

      return Ok(tempBans);
    } catch (err) {
      this.logger.error(
        { err, guildId },
        "Failed to find temp bans by guild ID",
      );
      return Err(`Failed to find temp bans: ${err}`);
    }
  }

  async findByGuildAndUserId(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<TempBan | null, string>> {
    const db = tx || this.db;
    try {
      const result = await db
        .select()
        .from(tempBansInAppPublic)
        .where(
          and(
            eq(tempBansInAppPublic.guildId, BigInt(guildId)),
            eq(tempBansInAppPublic.userId, BigInt(userId)),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return Ok(null);
      }

      const row = result[0];
      const tempBan = TempBan.fromDatabase(
        row.userId.toString(),
        row.guildId.toString(),
        row.expiresAt,
        row.createdAt,
      );

      return Ok(tempBan);
    } catch (err) {
      this.logger.error(
        { err, guildId, userId },
        "Failed to find temp ban by guild and user ID",
      );
      return Err(`Failed to find temp ban: ${err}`);
    }
  }

  async findExpired(
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<TempBan[], string>> {
    const db = tx || this.db;
    try {
      const now = dayjs.utc().toISOString();
      const results = await db
        .select()
        .from(tempBansInAppPublic)
        .where(lte(tempBansInAppPublic.expiresAt, now));

      const tempBans = results.map((row) =>
        TempBan.fromDatabase(
          row.userId.toString(),
          row.guildId.toString(),
          row.expiresAt,
          row.createdAt,
        ),
      );

      return Ok(tempBans);
    } catch (err) {
      this.logger.error({ err }, "Failed to find expired temp bans");
      return Err(`Failed to find expired temp bans: ${err}`);
    }
  }

  async deleteExpired(
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<TempBan[], string>> {
    const db = tx || this.db;
    try {
      const now = dayjs.utc().toISOString();
      const results = await db
        .delete(tempBansInAppPublic)
        .where(lte(tempBansInAppPublic.expiresAt, now))
        .returning();

      const tempBans = results.map((row) =>
        TempBan.fromDatabase(
          row.userId.toString(),
          row.guildId.toString(),
          row.expiresAt,
          row.createdAt,
        ),
      );

      this.logger.debug(
        {
          deletedCount: tempBans.length,
        },
        "Deleted expired temp bans",
      );

      return Ok(tempBans);
    } catch (err) {
      this.logger.error({ err }, "Failed to delete expired temp bans");
      return Err(`Failed to delete expired temp bans: ${err}`);
    }
  }
}
