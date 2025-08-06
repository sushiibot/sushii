import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Result } from "ts-results";

import * as schema from "@/infrastructure/database/schema";

import { DMResult, ModerationCase } from "../entities/ModerationCase";
import { ActionType } from "../value-objects/ActionType";

/**
 * Repository interface for mod log specific operations.
 * Extends basic moderation case operations with audit log workflow support.
 */
export interface ModLogRepository {
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
   * Creates a new mod log case from audit log data.
   */
  createCase(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase, string>>;

  /**
   * Marks a pending case as not pending.
   * Used when an audit log event is matched to a pending case.
   */
  markAsNotPending(
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /**
   * Updates a mod log case with the Discord message ID.
   * Called after successfully posting to mod log channel.
   */
  updateMessageId(
    caseId: string,
    messageId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;

  /**
   * Updates a mod log case with DM result information.
   * Stores channel ID, message ID, and any error that occurred.
   */
  updateDMInfo(
    caseId: string,
    dmResult: DMResult,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>>;
}
