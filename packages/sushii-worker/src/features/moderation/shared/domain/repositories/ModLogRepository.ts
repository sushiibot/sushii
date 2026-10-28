import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

import type {
  DMFailureReason,
  DMResult,
  ModerationCase,
} from "../entities/ModerationCase";
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
  ): Promise<ModerationCase>;

  /**
   * Updates an existing moderation case.
   */
  update(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void>;

  /**
   * Finds a case by guild and case ID.
   */
  findById(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase | null>;

  /**
   * Finds all cases for a specific user in a guild.
   */
  findByUserIdNotPending(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]>;

  /**
   * Finds all cases across multiple users in a guild — the merged-history
   * query behind `/alts view`. Same ordering/pending-exclusion as
   * findByUserIdNotPending.
   */
  findByUserIdsNotPending(
    guildId: string,
    userIds: string[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]>;

  /**
   * Finds cases for a guild with pagination.
   */
  findByGuildId(
    guildId: string,
    limit?: number,
    offset?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]>;

  /**
   * Finds cases by case ID range.
   */
  findByRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]>;

  /**
   * Gets recent moderation cases for a guild.
   */
  findRecent(
    guildId: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]>;

  /**
   * Searches for cases by case ID prefix for autocomplete.
   */
  searchByIdPrefix(
    guildId: string,
    prefix: string,
    limit?: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]>;

  /**
   * Checks if a case exists by case ID.
   */
  exists(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<boolean>;

  /**
   * Deletes a single case.
   */
  delete(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void>;

  /**
   * Deletes multiple cases by case ID range and returns the deleted cases.
   */
  deleteRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]>;

  /**
   * Updates reason for multiple cases in a range and records who set it.
   * Leaves executor_id untouched.
   */
  updateReasonBulk(
    guildId: string,
    setById: string,
    startCaseId: number,
    endCaseId: number,
    reason: string,
    onlyEmpty: boolean,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]>;

  findByIds(guildId: string, caseIds: string[]): Promise<ModerationCase[]>;

  /** deletedBy and deletedAt are null when only an old mod log entry recorded the deletion. */
  markDmDeleted(
    guildId: string,
    caseId: string,
    deletedBy: string | null,
    deletedAt: Date | null,
  ): Promise<void>;
}

export interface LastReason {
  caseId: string;
  reason: string;
  executorId: string | null;
  actionTime: Date;
}

export interface RecentReason {
  caseId: string;
  reason: string;
}

/**
 * Reason lookups backing reason templates, autocomplete and form dropdowns.
 */
export interface ModLogReasonQueries {
  findLastReason(guildId: string): Promise<LastReason | null>;

  /**
   * Newest first, one entry per normalized reason.
   */
  findRecentDistinctReasons(
    guildId: string,
    limit: number,
  ): Promise<RecentReason[]>;

  /**
   * Counts the guild's newest 500 cases whose normalizeReason() equals
   * normalizedReason, stopping at cap.
   */
  countByNormalizedReason(
    guildId: string,
    normalizedReason: string,
    cap: number,
  ): Promise<number>;
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
  ): Promise<ModerationCase | null>;

  /**
   * Marks a pending case as not pending.
   * Used when an audit log event is matched to a pending case.
   * Returns null if no case was updated (e.g. it was deleted meanwhile).
   */
  markAsNotPending(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase | null>;

  /**
   * Updates a mod log case with the Discord message ID.
   * Called after successfully posting to mod log channel.
   */
  updateMessageId(
    guildId: string,
    caseId: string,
    messageId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void>;

  /**
   * Updates a mod log case with DM result information.
   * Stores channel ID, message ID, error, and the dmAttempted/dmIntended flags.
   */
  updateDMInfo(
    guildId: string,
    caseId: string,
    dmResult: DMResult,
    dmAttempted: boolean,
    dmIntended: boolean,
    dmFailureReason: DMFailureReason | null,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void>;
}

/**
 * Repository interface for mod log operations.
 * Combines case management and audit log specific operations.
 */
export interface ModLogRepository
  extends ModLogCaseOperations,
    ModLogAuditOperations,
    ModLogReasonQueries {
  /**
   * Returns true if the user has any moderation record in the given guild.
   * Used to verify a moderation relationship before exposing user history.
   */
  hasAnyForGuild(guildId: string, userId: string): Promise<boolean>;
}
