import { and, asc, between, desc, eq, gte, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import { modLogsInAppPublic } from "@/infrastructure/database/schema";
import dayjs from "@/shared/domain/dayjs";

import type {
  DMFailureReason,
  DMIntentSource,
  DMNotAttemptedReason,
  DMResult,
} from "../../domain/entities/ModerationCase";
import { ModerationCase } from "../../domain/entities/ModerationCase";
import type { ModLogRepository } from "../../domain/repositories/ModLogRepository";
import type { ActionType } from "../../domain/value-objects/ActionType";
import { actionTypeFromString } from "../../domain/value-objects/ActionType";
import { Reason } from "../../domain/value-objects/Reason";

export class DrizzleModLogRepository implements ModLogRepository {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async findPendingCase(
    guildId: string,
    userId: string,
    actionType: ActionType,
    maxAgeMinutes: number = 1,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase | null, string>> {
    const db = tx || this.db;
    try {
      const minimumTime = dayjs
        .utc()
        .subtract(maxAgeMinutes, "minute")
        .toDate();

      const result = await db
        .select()
        .from(modLogsInAppPublic)
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            eq(modLogsInAppPublic.userId, BigInt(userId)),
            eq(modLogsInAppPublic.action, actionType),
            eq(modLogsInAppPublic.pending, true),
            gte(modLogsInAppPublic.actionTime, minimumTime),
          ),
        )
        .orderBy(desc(modLogsInAppPublic.actionTime))
        .limit(1);

      if (result.length === 0) {
        return Ok(null);
      }

      const row = result[0];
      const moderationCase = this.mapRowToModerationCase(row);

      return Ok(moderationCase);
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId,
          userId,
          actionType,
          maxAgeMinutes,
        },
        "Failed to find pending case",
      );
      return Err(`Failed to find pending case: ${error}`);
    }
  }

  async createCase(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase, string>> {
    const db = tx || this.db;
    try {
      const dmResult = moderationCase.dmResult;

      // Generate case ID using the same pattern as the legacy insertModLog
      const insertResult = await db
        .insert(modLogsInAppPublic)
        .values({
          guildId: BigInt(moderationCase.guildId),
          caseId: sql`(SELECT COALESCE(MAX(case_id), 0) + 1 FROM app_public.mod_logs WHERE guild_id = ${BigInt(moderationCase.guildId)})`,
          action: moderationCase.actionType,
          actionTime: moderationCase.actionTime,
          pending: moderationCase.pending,
          userId: BigInt(moderationCase.userId),
          userTag: moderationCase.userTag,
          executorId: moderationCase.executorId
            ? BigInt(moderationCase.executorId)
            : null,
          reason: moderationCase.reason?.value || null,
          msgId: moderationCase.msgId ? BigInt(moderationCase.msgId) : null,
          attachments: moderationCase.attachments,
          dmChannelId: dmResult?.channelId ? BigInt(dmResult.channelId) : null,
          dmMessageId: dmResult?.messageId ? BigInt(dmResult.messageId) : null,
          dmMessageError: dmResult?.error || null,
          dmIntended: moderationCase.dmIntended,
          dmIntentSource: moderationCase.dmIntentSource,
          dmAttempted: moderationCase.dmAttempted,
          dmNotAttemptedReason: moderationCase.dmNotAttemptedReason,
          dmFailureReason: moderationCase.dmFailureReason,
          timeoutDuration: moderationCase.timeoutDuration
            ? BigInt(moderationCase.timeoutDuration)
            : null,
        })
        .returning();

      if (insertResult.length === 0) {
        return Err("Failed to create case - no rows returned");
      }

      const createdCase = this.mapRowToModerationCase(insertResult[0]);
      return Ok(createdCase);
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: moderationCase.guildId,
          caseId: moderationCase.caseId,
          actionType: moderationCase.actionType,
        },
        "Failed to create case",
      );
      return Err(`Failed to create case: ${error}`);
    }
  }

  async markAsNotPending(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase, string>> {
    const db = tx || this.db;

    this.logger.debug(
      {
        guildId,
        caseId,
        usingTransaction: !!tx,
      },
      "Attempting to mark case as not pending",
    );

    const updatedCase = await db
      .update(modLogsInAppPublic)
      .set({ pending: false })
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogsInAppPublic.caseId, BigInt(caseId)),
        ),
      )
      .returning();

    if (updatedCase.length === 0) {
      this.logger.warn(
        {
          guildId,
          caseId,
        },
        "No rows updated when marking case as not pending",
      );

      return Err("Failed to mark case as not pending - no rows updated");
    }

    const mappedCase = this.mapRowToModerationCase(updatedCase[0]);

    this.logger.debug(
      {
        guildId,
        caseId,
        pendingAfterUpdate: mappedCase.pending,
        rowsUpdated: updatedCase.length,
      },
      "Successfully marked case as not pending in database",
    );

    return Ok(mappedCase);
  }

  async updateMessageId(
    guildId: string,
    caseId: string,
    messageId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;

    this.logger.debug(
      {
        guildId,
        caseId,
        messageId,
        usingTransaction: !!tx,
      },
      "Attempting to update message ID for case",
    );

    const result = await db
      .update(modLogsInAppPublic)
      .set({ msgId: BigInt(messageId) })
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogsInAppPublic.caseId, BigInt(caseId)),
        ),
      );

    this.logger.debug(
      {
        guildId,
        caseId,
        messageId,
        updatedRowCount: result.rowCount,
      },
      "Successfully updated message ID in database",
    );

    return Ok.EMPTY;
  }

  async updateDMInfo(
    guildId: string,
    caseId: string,
    dmResult: DMResult,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    await db
      .update(modLogsInAppPublic)
      .set({
        dmChannelId: dmResult.channelId ? BigInt(dmResult.channelId) : null,
        dmMessageId: dmResult.messageId ? BigInt(dmResult.messageId) : null,
        dmMessageError: dmResult.error || null,
      })
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogsInAppPublic.caseId, BigInt(caseId)),
        ),
      );

    return Ok.EMPTY;
  }

  async findById(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase | null, string>> {
    const db = tx || this.db;
    try {
      const result = await db
        .select()
        .from(modLogsInAppPublic)
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            eq(modLogsInAppPublic.caseId, BigInt(caseId)),
          ),
        )
        .limit(1);

      if (result.length === 0) {
        return Ok(null);
      }

      const row = result[0];
      const moderationCase = this.mapRowToModerationCase(row);
      return Ok(moderationCase);
    } catch (err) {
      this.logger.error(
        { err, caseId: caseId.toString() },
        "Failed to find moderation case by ID",
      );
      return Err(`Failed to find moderation case: ${err}`);
    }
  }

  async findByUserIdNotPending(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>> {
    const db = tx || this.db;
    try {
      const results = await db
        .select()
        .from(modLogsInAppPublic)
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            eq(modLogsInAppPublic.userId, BigInt(userId)),
            eq(modLogsInAppPublic.pending, false),
          ),
        )
        .orderBy(asc(modLogsInAppPublic.caseId))
        .limit(500);

      const cases = results.map((row) => this.mapRowToModerationCase(row));
      return Ok(cases);
    } catch (err) {
      this.logger.error(
        { err, guildId, userId },
        "Failed to find moderation cases by user ID",
      );
      return Err(`Failed to find moderation cases: ${err}`);
    }
  }

  async findByGuildId(
    guildId: string,
    limit = 50,
    offset = 0,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>> {
    const db = tx || this.db;
    try {
      const results = await db
        .select()
        .from(modLogsInAppPublic)
        .where(eq(modLogsInAppPublic.guildId, BigInt(guildId)))
        .orderBy(desc(modLogsInAppPublic.actionTime))
        .limit(limit)
        .offset(offset);

      const cases = results.map((row) => this.mapRowToModerationCase(row));
      return Ok(cases);
    } catch (err) {
      this.logger.error(
        { err, guildId, limit, offset },
        "Failed to find moderation cases by guild ID",
      );
      return Err(`Failed to find moderation cases: ${err}`);
    }
  }

  async update(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    try {
      const dmResult = moderationCase.dmResult;

      await db
        .update(modLogsInAppPublic)
        .set({
          action: moderationCase.actionType,
          actionTime: moderationCase.actionTime,
          pending: moderationCase.pending,
          userTag: moderationCase.userTag,
          executorId: moderationCase.executorId
            ? BigInt(moderationCase.executorId)
            : null,
          reason: moderationCase.reason?.value || null,
          msgId: moderationCase.msgId ? BigInt(moderationCase.msgId) : null,
          attachments: moderationCase.attachments,
          dmChannelId: dmResult?.channelId ? BigInt(dmResult.channelId) : null,
          dmMessageId: dmResult?.messageId ? BigInt(dmResult.messageId) : null,
          dmMessageError: dmResult?.error || null,
          dmIntended: moderationCase.dmIntended,
          dmIntentSource: moderationCase.dmIntentSource,
          dmAttempted: moderationCase.dmAttempted,
          dmNotAttemptedReason: moderationCase.dmNotAttemptedReason,
          dmFailureReason: moderationCase.dmFailureReason,
        })
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(moderationCase.guildId)),
            eq(modLogsInAppPublic.caseId, BigInt(moderationCase.caseId)),
          ),
        );

      return Ok.EMPTY;
    } catch (err) {
      this.logger.error({ err }, "Failed to update moderation case");
      return Err(`Failed to update moderation case: ${err}`);
    }
  }

  async delete(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    try {
      await db
        .delete(modLogsInAppPublic)
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            eq(modLogsInAppPublic.caseId, BigInt(caseId)),
          ),
        );

      return Ok.EMPTY;
    } catch (err) {
      this.logger.error(
        { err, guildId, caseId },
        "Failed to delete moderation case",
      );
      return Err(`Failed to delete moderation case: ${err}`);
    }
  }

  async deleteRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>> {
    const db = tx || this.db;
    try {
      const result = await db
        .delete(modLogsInAppPublic)
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            between(
              modLogsInAppPublic.caseId,
              BigInt(startCaseId),
              BigInt(endCaseId),
            ),
          ),
        )
        .returning();

      const deletedCases = result.map((row) =>
        this.mapRowToModerationCase(row),
      );

      this.logger.debug(
        {
          guildId,
          startCaseId,
          endCaseId,
          deletedCount: deletedCases.length,
        },
        "Deleted case range",
      );

      return Ok(deletedCases);
    } catch (err) {
      this.logger.error(
        { err, guildId, startCaseId, endCaseId },
        "Failed to delete case range",
      );
      return Err(`Failed to delete case range: ${err}`);
    }
  }

  async exists(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<boolean, string>> {
    const db = tx || this.db;
    try {
      const result = await db
        .select({ caseId: modLogsInAppPublic.caseId })
        .from(modLogsInAppPublic)
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            eq(modLogsInAppPublic.caseId, BigInt(caseId)),
          ),
        )
        .limit(1);

      return Ok(result.length > 0);
    } catch (err) {
      this.logger.error(
        { err, guildId, caseId },
        "Failed to check case existence",
      );
      return Err(`Failed to check case existence: ${err}`);
    }
  }

  async findByRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>> {
    const db = tx || this.db;
    try {
      const results = await db
        .select()
        .from(modLogsInAppPublic)
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            between(
              modLogsInAppPublic.caseId,
              BigInt(startCaseId),
              BigInt(endCaseId),
            ),
          ),
        )
        .orderBy(desc(modLogsInAppPublic.caseId));

      const cases = results.map((row) => this.mapRowToModerationCase(row));
      return Ok(cases);
    } catch (err) {
      this.logger.error(
        { err, guildId, startCaseId, endCaseId },
        "Failed to find cases by range",
      );
      return Err(`Failed to find cases by range: ${err}`);
    }
  }

  async updateReasonBulk(
    guildId: string,
    executorId: string,
    startCaseId: number,
    endCaseId: number,
    reason: string,
    onlyEmpty: boolean,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>> {
    const db = tx || this.db;
    try {
      const conditions = [
        eq(modLogsInAppPublic.guildId, BigInt(guildId)),
        between(
          modLogsInAppPublic.caseId,
          BigInt(startCaseId),
          BigInt(endCaseId),
        ),
      ];

      if (onlyEmpty) {
        conditions.push(isNull(modLogsInAppPublic.reason));
      }

      const result = await db
        .update(modLogsInAppPublic)
        .set({
          reason,
          executorId: BigInt(executorId),
        })
        .where(and(...conditions))
        .returning();

      const updatedCases = result.map((row) =>
        this.mapRowToModerationCase(row),
      );

      this.logger.debug(
        {
          guildId,
          startCaseId,
          endCaseId,
          updatedCount: updatedCases.length,
          onlyEmpty,
        },
        "Bulk updated case reasons",
      );

      return Ok(updatedCases);
    } catch (err) {
      this.logger.error(
        { err, guildId, startCaseId, endCaseId },
        "Failed to bulk update reasons",
      );
      return Err(`Failed to bulk update reasons: ${err}`);
    }
  }

  async searchByIdPrefix(
    guildId: string,
    prefix: string,
    limit = 25,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>> {
    const db = tx || this.db;
    try {
      if (!/^\d+$/.test(prefix)) {
        return Ok([]);
      }

      const results = await db
        .select()
        .from(modLogsInAppPublic)
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            sql`CAST(${modLogsInAppPublic.caseId} AS TEXT) LIKE ${prefix + "%"}`,
          ),
        )
        .orderBy(desc(modLogsInAppPublic.caseId))
        .limit(limit);

      const cases = results.map((row) => this.mapRowToModerationCase(row));
      return Ok(cases);
    } catch (err) {
      this.logger.error(
        { err, guildId, prefix },
        "Failed to search cases by prefix",
      );
      return Err(`Failed to search cases by prefix: ${err}`);
    }
  }

  async findRecent(
    guildId: string,
    limit = 25,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<ModerationCase[], string>> {
    const db = tx || this.db;
    try {
      const results = await db
        .select()
        .from(modLogsInAppPublic)
        .where(eq(modLogsInAppPublic.guildId, BigInt(guildId)))
        .orderBy(desc(modLogsInAppPublic.caseId))
        .limit(limit);

      const cases = results.map((row) => this.mapRowToModerationCase(row));
      return Ok(cases);
    } catch (err) {
      this.logger.error({ err, guildId, limit }, "Failed to find recent cases");
      return Err(`Failed to find recent cases: ${err}`);
    }
  }

  private mapRowToModerationCase(
    row: typeof modLogsInAppPublic.$inferSelect,
  ): ModerationCase {
    const actionType = actionTypeFromString(row.action);
    const reason = row.reason ? Reason.create(row.reason).unwrap() : null;

    let dmResult: DMResult | null = null;
    if (row.dmChannelId || row.dmMessageId || row.dmMessageError) {
      dmResult = {
        channelId: row.dmChannelId?.toString(),
        messageId: row.dmMessageId?.toString(),
        error: row.dmMessageError || undefined,
      };
    }

    return new ModerationCase(
      row.guildId.toString(),
      row.caseId.toString(),
      actionType,
      row.actionTime,
      row.userId.toString(),
      row.userTag,
      row.executorId?.toString() || null,
      reason,
      row.msgId?.toString() || null,
      row.attachments || [],
      dmResult,
      row.pending,
      row.timeoutDuration ? Number(row.timeoutDuration) : null,
      row.dmIntended,
      row.dmIntentSource as DMIntentSource,
      row.dmAttempted,
      row.dmNotAttemptedReason as DMNotAttemptedReason | null,
      row.dmFailureReason as DMFailureReason | null,
    );
  }
}
