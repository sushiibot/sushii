import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Result } from "ts-results";

import * as schema from "@/infrastructure/database/schema";

import { GiveawayEntry } from "../entities/GiveawayEntry";

export interface GiveawayEntryRepository {
  /**
   * Create giveaway entries in batch
   */
  createBatch(
    entries: GiveawayEntry[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<number, string>>;

  /**
   * Find a giveaway entry by giveaway and user ID
   */
  findByGiveawayAndUser(
    giveawayId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<GiveawayEntry | null, string>>;

  /**
   * Count entries for a giveaway
   */
  countByGiveaway(
    giveawayId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<number, string>>;

  /**
   * Get random entries for a giveaway
   */
  findRandomEntries(
    giveawayId: string,
    count: number,
    allowRepeatWinners: boolean,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<GiveawayEntry[], string>>;

  /**
   * Mark entries as picked
   */
  markAsPicked(
    giveawayId: string,
    userIds: string[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /**
   * Delete a giveaway entry
   */
  delete(
    giveawayId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;
}