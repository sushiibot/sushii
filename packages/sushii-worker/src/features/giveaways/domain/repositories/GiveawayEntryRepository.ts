import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

import type { GiveawayEntry } from "../entities/GiveawayEntry";

export interface GiveawayEntryRepository {
  /**
   * Create giveaway entries in batch, skipping entries that already exist.
   * Returns the number of entries given.
   */
  createBatch(
    entries: GiveawayEntry[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<number>;

  /**
   * Find a giveaway entry by giveaway and user ID
   */
  findByGiveawayAndUser(
    giveawayId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<GiveawayEntry | null>;

  /**
   * Count entries for a giveaway
   */
  countByGiveaway(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<number>;

  /**
   * Get random entries for a giveaway
   */
  findRandomEntries(
    giveawayId: string,
    count: number,
    allowRepeatWinners: boolean,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<GiveawayEntry[]>;

  /**
   * Mark entries as picked
   */
  markAsPicked(
    giveawayId: string,
    userIds: string[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void>;

  /**
   * Delete a giveaway entry
   */
  delete(
    giveawayId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void>;
}
