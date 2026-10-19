import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { guildBansInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import { GuildBan } from "../domain/entities/GuildBan";
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

  async addBan(ban: GuildBan): Promise<void> {
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
  }

  async removeBan(guildId: string, userId: string): Promise<void> {
    await this.db
      .delete(guildBansInAppPublic)
      .where(
        and(
          eq(guildBansInAppPublic.guildId, BigInt(guildId)),
          eq(guildBansInAppPublic.userId, BigInt(userId)),
        ),
      );

    this.logger.debug({ guildId, userId }, "Removed ban from cache");
  }

  async clearGuildBans(guildId: string): Promise<void> {
    const result = await this.db
      .delete(guildBansInAppPublic)
      .where(eq(guildBansInAppPublic.guildId, BigInt(guildId)));

    this.logger.debug(
      { guildId, deletedRows: result.rowCount },
      "Cleared all bans for guild",
    );
  }

  async addGuildBans(guildId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

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
  }

  async getUserBans(userId: string): Promise<GuildBan[]> {
    const bans = await this.db
      .select()
      .from(guildBansInAppPublic)
      .where(eq(guildBansInAppPublic.userId, BigInt(userId)));

    const mappedBans: GuildBan[] = bans.map((ban) =>
      GuildBan.fromData(ban.guildId.toString(), ban.userId.toString()),
    );

    this.logger.debug(
      { userId, banCount: mappedBans.length },
      "Fetched user bans",
    );

    return mappedBans;
  }
}
