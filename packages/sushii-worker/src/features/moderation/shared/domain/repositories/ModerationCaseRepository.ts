import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";

import type { ModerationCase } from "../entities/ModerationCase";

export interface ModerationCaseRepository {
  save(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  findById(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase | null, string>>;

  findByUserId(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  findByGuildId(
    guildId: string,
    limit?: number,
    offset?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Gets the next case number for a guild.
   * When used within a transaction, automatically applies row locking to prevent race conditions.
   */
  getNextCaseNumber(
    guildId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<bigint, string>>;

  update(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  delete(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /**
   * Delete multiple cases by case ID range and return the deleted cases
   * Used by UncaseCommand for bulk deletion
   */
  deleteRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Check if a case exists by case ID
   * Used for validation before operations
   */
  exists(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<boolean, string>>;

  /**
   * Find cases by case ID range
   * Used for bulk operations like reason updates
   */
  findByRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Update reason for multiple cases in a range
   * @param onlyEmpty - If true, only update cases without existing reasons
   * @returns Updated cases
   */
  updateReasonBulk(
    guildId: string,
    executorId: string,
    startCaseId: number,
    endCaseId: number,
    reason: string,
    onlyEmpty: boolean,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Search for cases by case ID prefix
   * Used for autocomplete functionality
   */
  searchByIdPrefix(
    guildId: string,
    prefix: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Get recent moderation cases for a guild
   * Used for autocomplete and listing recent actions
   */
  findRecent(
    guildId: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;
}
