import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Result } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";

import type { DMResult, ModerationCase } from "../entities/ModerationCase";
import type { ActionType } from "../value-objects/ActionType";

/**
 * Repository interface for mod log specific operations.
 * Extends basic moderation case operations with audit log workflow support.
 */
/**
 * Core case management operations.
 */
export interface ModLogCaseOperations {
  /**
   * Creates a new moderation case with auto-generated case ID.
   * Used for all new case creation to avoid race conditions.
   */
  createCase(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase, string>>;

  /**
   * Updates an existing moderation case.
   */
  update(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /**
   * Finds a case by guild and case ID.
   */
  findById(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase | null, string>>;

  /**
   * Finds all cases for a specific user in a guild.
   */
  findByUserIdNotPending(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Finds cases for a guild with pagination.
   */
  findByGuildId(
    guildId: string,
    limit?: number,
    offset?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Finds cases by case ID range.
   */
  findByRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Gets recent moderation cases for a guild.
   */
  findRecent(
    guildId: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Searches for cases by case ID prefix for autocomplete.
   */
  searchByIdPrefix(
    guildId: string,
    prefix: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Checks if a case exists by case ID.
   */
  exists(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<boolean, string>>;

  /**
   * Deletes a single case.
   */
  delete(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /**
   * Deletes multiple cases by case ID range and returns the deleted cases.
   */
  deleteRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>>;

  /**
   * Updates reason for multiple cases in a range.
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
}

/**
 * Audit log specific operations.
 */
export interface ModLogAuditOperations {
  /**
   * Finds a pending mod log case that matches the given criteria.
   * Used for audit log processing to link Discord events with pending cases.
   */
  findPendingCase(
    guildId: string,
    userId: string,
    actionType: ActionType,
    maxAgeMinutes?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase | null, string>>;

  /**
   * Marks a pending case as not pending.
   * Used when an audit log event is matched to a pending case.
   */
  markAsNotPending(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /**
   * Updates a mod log case with the Discord message ID.
   * Called after successfully posting to mod log channel.
   */
  updateMessageId(
    guildId: string,
    caseId: string,
    messageId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /**
   * Updates a mod log case with DM result information.
   * Stores channel ID, message ID, and any error that occurred.
   */
  updateDMInfo(
    guildId: string,
    caseId: string,
    dmResult: DMResult,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;
}

/**
 * Repository interface for mod log operations.
 * Combines case management and audit log specific operations.
 */
export interface ModLogRepository
  extends ModLogCaseOperations,
    ModLogAuditOperations {}
