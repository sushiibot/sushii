import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";

import type { Giveaway } from "../entities/Giveaway";

export interface GiveawayRepository {
  /**
   * Create a new giveaway
   */
  create(
    giveaway: Giveaway,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway, string>>;

  /**
   * Find a giveaway by guild and ID
   */
  findByGuildAndId(
    guildId: string,
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway | null, string>>;

  /**
   * Find all active giveaways for a guild
   */
  findActiveByGuild(
    guildId: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway[], string>>;

  /**
   * Find all completed giveaways for a guild
   */
  findCompletedByGuild(
    guildId: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway[], string>>;

  /**
   * Count all active giveaways across all guilds
   */
  countActiveGiveaways(
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<number, string>>;

  /**
   * Find all expired giveaways and mark them as ended
   */
  findAndMarkExpiredAsEnded(
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway[], string>>;

  /**
   * Update a giveaway
   */
  update(
    giveaway: Giveaway,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway, string>>;

  /**
   * Mark a giveaway as ended
   */
  markAsEnded(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway | null, string>>;

  /**
   * Delete a giveaway
   */
  delete(
    guildId: string,
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<Giveaway | null, string>>;
}