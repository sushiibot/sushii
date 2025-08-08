import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import { modLogsInAppPublic } from "@/infrastructure/database/schema";
import dayjs from "@/shared/domain/dayjs";

import type { DMResult} from "../../domain/entities/ModerationCase";
import { ModerationCase } from "../../domain/entities/ModerationCase";
import type { ModLogRepository } from "../../domain/repositories/ModLogRepository";
import type {
  ActionType} from "../../domain/value-objects/ActionType";
import {
  actionTypeFromString,
} from "../../domain/value-objects/ActionType";
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
    caseId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    try {
      await db
        .update(modLogsInAppPublic)
        .set({ pending: false })
        .where(eq(modLogsInAppPublic.caseId, BigInt(caseId)));

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          caseId,
        },
        "Failed to mark case as not pending",
      );
      return Err(`Failed to mark case as not pending: ${error}`);
    }
  }

  async updateMessageId(
    caseId: string,
    messageId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    try {
      await db
        .update(modLogsInAppPublic)
        .set({ msgId: BigInt(messageId) })
        .where(eq(modLogsInAppPublic.caseId, BigInt(caseId)));

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          caseId,
          messageId,
        },
        "Failed to update message ID",
      );
      return Err(`Failed to update message ID: ${error}`);
    }
  }

  async updateDMInfo(
    caseId: string,
    dmResult: DMResult,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    try {
      await db
        .update(modLogsInAppPublic)
        .set({
          dmChannelId: dmResult.channelId ? BigInt(dmResult.channelId) : null,
          dmMessageId: dmResult.messageId ? BigInt(dmResult.messageId) : null,
          dmMessageError: dmResult.error || null,
        })
        .where(eq(modLogsInAppPublic.caseId, BigInt(caseId)));

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          caseId,
          dmResult,
        },
        "Failed to update DM info",
      );
      return Err(`Failed to update DM info: ${error}`);
    }
  }

  private mapRowToModerationCase(
    row: typeof modLogsInAppPublic.$inferInsert,
  ): ModerationCase {
    const dmResult: DMResult | null =
      row.dmChannelId || row.dmMessageId || row.dmMessageError
        ? {
            channelId: row.dmChannelId?.toString(),
            messageId: row.dmMessageId?.toString(),
            error: row.dmMessageError || undefined,
          }
        : null;

    return new ModerationCase(
      row.guildId.toString(),
      row.caseId.toString(),
      actionTypeFromString(row.action),
      row.actionTime,
      row.userId.toString(),
      row.userTag,
      row.executorId?.toString() || null,
      row.reason ? Reason.create(row.reason).unwrap() : null,
      row.msgId?.toString() || null,
      row.attachments || [],
      dmResult,
      row.pending,
    );
  }
}
