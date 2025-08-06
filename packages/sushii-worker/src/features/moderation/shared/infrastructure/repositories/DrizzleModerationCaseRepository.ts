import { and, between, desc, eq, isNull, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";
import { Err, Ok, Result } from "ts-results";

import * as schema from "@/infrastructure/database/schema";
import { modLogsInAppPublic } from "@/infrastructure/database/schema";

import { DMResult, ModerationCase } from "../../domain/entities/ModerationCase";
import { ModerationCaseRepository } from "../../domain/repositories/ModerationCaseRepository";
import { actionTypeFromString } from "../../domain/value-objects/ActionType";
import { Reason } from "../../domain/value-objects/Reason";

export class DrizzleModerationCaseRepository
  implements ModerationCaseRepository
{
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async save(
    moderationCase: ModerationCase,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    const db = tx || this.db;
    try {
      const dmResult = moderationCase.dmResult;

      await db.insert(modLogsInAppPublic).values({
        guildId: BigInt(moderationCase.guildId),
        caseId: BigInt(moderationCase.caseId),
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
      });

      return Ok.EMPTY;
    } catch (err) {
      this.logger.error({ err }, "Failed to save moderation case");
      return Err(`Failed to save moderation case: ${err}`);
    }
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

  async findByUserId(
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
          ),
        )
        .orderBy(desc(modLogsInAppPublic.actionTime))
        .limit(500); // Safety limit to prevent Discord embed failures and performance issues

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

  async getNextCaseNumber(
    guildId: string,
    tx?: NodePgDatabase<typeof schema>,
  ): Promise<Result<bigint, string>> {
    const db = tx || this.db;
    try {
      const result = await db
        .select({ maxCaseId: modLogsInAppPublic.caseId })
        .from(modLogsInAppPublic)
        .where(eq(modLogsInAppPublic.guildId, BigInt(guildId)))
        .orderBy(desc(modLogsInAppPublic.caseId))
        .limit(1)
        .for("update"); // Row locking for concurrent safety

      const nextCaseNumber = result.length > 0 ? result[0].maxCaseId + 1n : 1n;
      return Ok(nextCaseNumber);
    } catch (err) {
      this.logger.error({ err, guildId }, "Failed to get next case number");
      return Err(`Failed to get next case number: ${err}`);
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
    );
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

      // Add condition to only update empty reasons if requested
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
      // Validate prefix contains only digits
      if (!/^\d+$/.test(prefix)) {
        return Ok([]); // Invalid numeric prefix
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
}
