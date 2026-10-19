import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

import type { TempBan } from "../entities/TempBan";

export interface TempBanRepository {
  /**
   * Save a temp ban to the database (insert or update)
   */
  save(tempBan: TempBan, tx?: NodePgDatabase<typeof schema>): Promise<void>;

  /**
   * Delete a temp ban by user and guild ID
   * Returns the deleted temp ban if it existed, null if not found
   */
  delete(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<TempBan | null>;

  /**
   * Find all temp bans for a guild
   */
  findByGuildId(
    guildId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<TempBan[]>;

  /**
   * Find a specific temp ban by guild and user ID
   */
  findByGuildAndUserId(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<TempBan | null>;

  /**
   * Find all expired temp bans across all guilds
   */
  findExpired(tx?: NodePgDatabase<typeof schema>): Promise<TempBan[]>;

  /**
   * Delete all expired temp bans and return them
   * Used by the background task to process expiries
   */
  deleteExpired(tx?: NodePgDatabase<typeof schema>): Promise<TempBan[]>;
}
