import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import { guildBansInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type { GuildBan } from "../domain/entities/GuildBan";
import type { BanRepository } from "../domain/repositories/BanRepository";

/**
 * Drizzle ORM implementation of the BanRepository.
 * Handles database operations for guild ban cache.
 */
export class DrizzleBanRepository implements BanRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async addBan(ban: GuildBan): Promise<Result<void, string>> {
    try {
      await this.db
        .insert(guildBansInAppPublic)
        .values({
          guildId: BigInt(ban.guildId),
          userId: BigInt(ban.userId),
        })
        .onConflictDoNothing();

      this.logger.debug(
        { guildId: ban.guildId, userId: ban.userId },
        "Added ban to cache",
      );

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error(
        { err: error, guildId: ban.guildId, userId: ban.userId },
        "Failed to add ban to cache",
      );
      return Err("Ban operation failed");
    }
  }

  async removeBan(
    guildId: string,
    userId: string,
  ): Promise<Result<void, string>> {
    try {
      await this.db
        .delete(guildBansInAppPublic)
        .where(
          and(
            eq(guildBansInAppPublic.guildId, BigInt(guildId)),
            eq(guildBansInAppPublic.userId, BigInt(userId)),
          ),
        );

      this.logger.debug({ guildId, userId }, "Removed ban from cache");

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error(
        { err: error, guildId, userId },
        "Failed to remove ban from cache",
      );
      return Err("Ban removal failed");
    }
  }

  async clearGuildBans(guildId: string): Promise<Result<void, string>> {
    try {
      const result = await this.db
        .delete(guildBansInAppPublic)
        .where(eq(guildBansInAppPublic.guildId, BigInt(guildId)));

      this.logger.debug(
        { guildId, deletedRows: result.rowCount },
        "Cleared all bans for guild",
      );

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error({ err: error, guildId }, "Failed to clear guild bans");
      return Err("Guild ban clearing failed");
    }
  }

  async addGuildBans(
    guildId: string,
    userIds: string[],
  ): Promise<Result<void, string>> {
    if (userIds.length === 0) {
      return Ok.EMPTY;
    }

    try {
      const values = userIds.map((userId) => ({
        guildId: BigInt(guildId),
        userId: BigInt(userId),
      }));

      await this.db
        .insert(guildBansInAppPublic)
        .values(values)
        .onConflictDoNothing();

      this.logger.debug(
        { guildId, banCount: userIds.length },
        "Added multiple bans to cache",
      );

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error(
        { err: error, guildId, banCount: userIds.length },
        "Failed to add guild bans to cache",
      );

      return Err("Guild ban insertion failed");
    }
  }
}
