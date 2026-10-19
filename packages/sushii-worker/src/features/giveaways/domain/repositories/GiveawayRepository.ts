import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

import type { Giveaway } from "../entities/Giveaway";

export interface GiveawayRepository {
  /**
   * Create a new giveaway
   */
  create(
    giveaway: Giveaway,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway>;

  /**
   * Find a giveaway by guild and ID
   */
  findByGuildAndId(
    guildId: string,
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null>;

  /**
   * Find all active giveaways for a guild
   */
  findActiveByGuild(
    guildId: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway[]>;

  /**
   * Find all completed giveaways for a guild
   */
  findCompletedByGuild(
    guildId: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway[]>;

  /**
   * Count all active giveaways across all guilds
   */
  countActiveGiveaways(tx?: NodePgDatabase<typeof schema>): Promise<number>;

  /**
   * Find all expired giveaways that have not been ended yet
   */
  findExpired(tx?: NodePgDatabase<typeof schema>): Promise<Giveaway[]>;

  /**
   * Atomically mark a giveaway as ended if it isn't already. Returns the
   * claimed giveaway, or null if it was already ended (or deleted), so only
   * one caller can end a giveaway.
   */
  claimForEnding(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null>;

  /**
   * Undo claimForEnding so the giveaway is retried
   */
  releaseEndingClaim(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void>;

  /**
   * Update a giveaway. Returns null if it doesn't exist.
   */
  update(
    giveaway: Giveaway,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null>;

  /**
   * Mark a giveaway as ended. Returns null if it doesn't exist.
   */
  markAsEnded(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null>;

  /**
   * Delete a giveaway. Returns null if it doesn't exist.
   */
  delete(
    guildId: string,
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Giveaway | null>;
}
