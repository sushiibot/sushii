import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

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
  ): Promise<ModerationCase | null> {
    const db = tx || this.db;
    const minimumTime = dayjs.utc().subtract(maxAgeMinutes, "minute").toDate();

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
      return null;
    }

    const row = result[0];
    const moderationCase = this.mapRowToModerationCase(row);

    return moderationCase;
  }

  /** Acquires pg_advisory_xact_lock(guildId); when tx is supplied, the lock is held for the caller's entire transaction. */
  async createCase(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase> {
    const doInsert = async (
      activeTx: NodePgDatabase<typeof schema>,
    ): Promise<ModerationCase> => {
      const guildIdBigInt = BigInt(moderationCase.guildId);

      await activeTx.execute(
        sql`SELECT pg_advisory_xact_lock(${guildIdBigInt})`,
      );

      const dmResult = moderationCase.dmResult;

      const insertResult = await activeTx
        .insert(modLogsInAppPublic)
        .values({
          guildId: guildIdBigInt,
          caseId: sql`(SELECT COALESCE(MAX(case_id), 0) + 1 FROM app_public.mod_logs WHERE guild_id = ${guildIdBigInt})`,
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
          dmMessageError: dmResult?.error ?? null,
          dmIntended: moderationCase.dmIntended,
          dmIntentSource: moderationCase.dmIntentSource,
          dmAttempted: moderationCase.dmAttempted,
          dmNotAttemptedReason: moderationCase.dmNotAttemptedReason,
          dmFailureReason: moderationCase.dmFailureReason,
          timeoutDuration:
            moderationCase.timeoutDuration !== null
              ? BigInt(moderationCase.timeoutDuration)
              : null,
          deleteMessageSeconds:
            moderationCase.deleteMessageSeconds !== null
              ? BigInt(moderationCase.deleteMessageSeconds)
              : null,
        })
        .returning();

      if (insertResult.length === 0) {
        throw new Error("Failed to create case - no rows returned");
      }

      return this.mapRowToModerationCase(insertResult[0]);
    };

    const createdCase = tx
      ? await doInsert(tx)
      : await this.db.transaction((innerTx) => doInsert(innerTx));

    return createdCase;
  }

  async markAsNotPending(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase | null> {
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

      return null;
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

    return mappedCase;
  }

  async updateMessageId(
    guildId: string,
    caseId: string,
    messageId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void> {
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
  }

  async updateDMInfo(
    guildId: string,
    caseId: string,
    dmResult: DMResult,
    dmAttempted: boolean,
    dmIntended: boolean,
    dmFailureReason: DMFailureReason | null,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void> {
    const db = tx || this.db;
    await db
      .update(modLogsInAppPublic)
      .set({
        dmChannelId: dmResult.channelId ? BigInt(dmResult.channelId) : null,
        dmMessageId: dmResult.messageId ? BigInt(dmResult.messageId) : null,
        dmMessageError: dmResult.error ?? null,
        dmFailureReason,
        dmAttempted,
        dmIntended,
      })
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogsInAppPublic.caseId, BigInt(caseId)),
        ),
      );
  }

  async findById(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase | null> {
    const db = tx || this.db;
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
      return null;
    }

    const row = result[0];
    const moderationCase = this.mapRowToModerationCase(row);
    return moderationCase;
  }

  async findByUserIdNotPending(
    guildId: string,
    userId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]> {
    return this.findByUserIdsNotPending(guildId, [userId], tx);
  }

  async findByUserIdsNotPending(
    guildId: string,
    userIds: string[],
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]> {
    const db = tx || this.db;
    const results = await db
      .select()
      .from(modLogsInAppPublic)
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(guildId)),
          inArray(
            modLogsInAppPublic.userId,
            userIds.map((userId) => BigInt(userId)),
          ),
          eq(modLogsInAppPublic.pending, false),
        ),
      )
      .orderBy(asc(modLogsInAppPublic.caseId))
      .limit(500);

    const cases = results.map((row) => this.mapRowToModerationCase(row));
    return cases;
  }

  async findByGuildId(
    guildId: string,
    limit = 50,
    offset = 0,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]> {
    const db = tx || this.db;
    const results = await db
      .select()
      .from(modLogsInAppPublic)
      .where(eq(modLogsInAppPublic.guildId, BigInt(guildId)))
      .orderBy(desc(modLogsInAppPublic.actionTime))
      .limit(limit)
      .offset(offset);

    const cases = results.map((row) => this.mapRowToModerationCase(row));
    return cases;
  }

  async update(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void> {
    const db = tx || this.db;
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
        dmMessageError: dmResult?.error ?? null,
        dmIntended: moderationCase.dmIntended,
        dmIntentSource: moderationCase.dmIntentSource,
        dmAttempted: moderationCase.dmAttempted,
        dmNotAttemptedReason: moderationCase.dmNotAttemptedReason,
        dmFailureReason: moderationCase.dmFailureReason,
        timeoutDuration:
          moderationCase.timeoutDuration !== null
            ? BigInt(moderationCase.timeoutDuration)
            : null,
        deleteMessageSeconds:
          moderationCase.deleteMessageSeconds !== null
            ? BigInt(moderationCase.deleteMessageSeconds)
            : null,
      })
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(moderationCase.guildId)),
          eq(modLogsInAppPublic.caseId, BigInt(moderationCase.caseId)),
        ),
      );
  }

  async delete(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<void> {
    const db = tx || this.db;
    await db
      .delete(modLogsInAppPublic)
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogsInAppPublic.caseId, BigInt(caseId)),
        ),
      );
  }

  async deleteRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]> {
    const db = tx || this.db;
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

    const deletedCases = result.map((row) => this.mapRowToModerationCase(row));

    this.logger.debug(
      {
        guildId,
        startCaseId,
        endCaseId,
        deletedCount: deletedCases.length,
      },
      "Deleted case range",
    );

    return deletedCases;
  }

  async exists(
    guildId: string,
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<boolean> {
    const db = tx || this.db;
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

    return result.length > 0;
  }

  async findByRange(
    guildId: string,
    startCaseId: number,
    endCaseId: number,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]> {
    const db = tx || this.db;
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
    return cases;
  }

  async updateReasonBulk(
    guildId: string,
    executorId: string,
    startCaseId: number,
    endCaseId: number,
    reason: string,
    onlyEmpty: boolean,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]> {
    const db = tx || this.db;
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

    const updatedCases = result.map((row) => this.mapRowToModerationCase(row));

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

    return updatedCases;
  }

  async searchByIdPrefix(
    guildId: string,
    prefix: string,
    limit = 25,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]> {
    const db = tx || this.db;
    if (!/^\d+$/.test(prefix)) {
      return [];
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
    return cases;
  }

  async findRecent(
    guildId: string,
    limit = 25,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<ModerationCase[]> {
    const db = tx || this.db;
    const results = await db
      .select()
      .from(modLogsInAppPublic)
      .where(eq(modLogsInAppPublic.guildId, BigInt(guildId)))
      .orderBy(desc(modLogsInAppPublic.caseId))
      .limit(limit);

    const cases = results.map((row) => this.mapRowToModerationCase(row));
    return cases;
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
        failureReason:
          (row.dmFailureReason as DMFailureReason | null) ?? undefined,
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
      row.timeoutDuration !== null ? Number(row.timeoutDuration) : null,
      row.dmIntended,
      row.dmIntentSource as DMIntentSource,
      row.dmAttempted,
      row.dmNotAttemptedReason as DMNotAttemptedReason | null,
      row.dmFailureReason as DMFailureReason | null,
      row.deleteMessageSeconds !== null
        ? Number(row.deleteMessageSeconds)
        : null,
    );
  }

  async hasAnyForGuild(guildId: string, userId: string): Promise<boolean> {
    const result = await this.db
      .select({ id: modLogsInAppPublic.caseId })
      .from(modLogsInAppPublic)
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(guildId)),
          eq(modLogsInAppPublic.userId, BigInt(userId)),
        ),
      )
      .limit(1);
    return result.length > 0;
  }
}
