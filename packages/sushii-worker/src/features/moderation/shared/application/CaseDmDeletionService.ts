import type { Client } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";

import type { ModerationCase } from "../domain/entities/ModerationCase";
import type { ModerationMetrics } from "../domain/metrics/ModerationMetrics";
import { NOOP_MODERATION_METRICS } from "../domain/metrics/ModerationMetrics";
import type { ModLogRepository } from "../domain/repositories/ModLogRepository";
import type { DMNotificationService } from "./DMNotificationService";
import type {
  ModLogMessageService,
  ModLogRefreshOutcome,
} from "./ModLogMessageService";

/**
 * - `deleted`: the DM is gone (or was already gone on Discord) and the case is marked
 * - `already_deleted`: the case was already marked, nothing was done
 * - `no_dm`: the case never had a delivered DM
 * - `not_found`: no case with that ID in the guild
 * - `failed`: Discord refused the delete; the case is left unmarked
 */
export type CaseDmDeletionResult =
  | "deleted"
  | "already_deleted"
  | "no_dm"
  | "not_found"
  | "failed";

export interface CaseDmDeletionOutcome {
  caseId: string;
  result: CaseDmDeletionResult;
  /** The case as it is now, null when not found. */
  moderationCase: ModerationCase | null;
  /** null when the mod log entry wasn't touched (nothing changed, or the caller re-renders it). */
  modLog: ModLogRefreshOutcome | null;
}

export interface CaseDmDeletionOptions {
  /** Case IDs whose mod log message the caller re-renders itself, e.g. with interaction.update(). */
  skipModLogRefreshFor?: readonly string[];
}

const GONE_ERROR_CODES: readonly number[] = [
  RESTJSONErrorCodes.UnknownMessage,
  RESTJSONErrorCodes.UnknownChannel,
];

/**
 * Deletes the DMs moderation cases sent, marks them deleted and re-renders
 * their mod log entries.
 */
export class CaseDmDeletionService {
  constructor(
    private readonly client: Client,
    private readonly modLogRepository: Pick<
      ModLogRepository,
      "findByIds" | "markDmDeleted"
    >,
    private readonly dmNotificationService: Pick<
      DMNotificationService,
      "deleteModerationDM"
    >,
    private readonly modLogMessageService: Pick<
      ModLogMessageService,
      "loadEntry" | "refreshEntry"
    >,
    private readonly logger: Logger,
    private readonly metrics: Pick<
      ModerationMetrics,
      "recordModLogEdit"
    > = NOOP_MODERATION_METRICS,
  ) {}

  async deleteDms(
    guildId: string,
    caseIds: readonly string[],
    deletedBy: string,
    options: CaseDmDeletionOptions = {},
  ): Promise<CaseDmDeletionOutcome[]> {
    const cases = await this.modLogRepository.findByIds(guildId, [...caseIds]);
    const byId = new Map(cases.map((c) => [c.caseId, c]));
    const skip = new Set(options.skipModLogRefreshFor ?? []);
    const outcomes: CaseDmDeletionOutcome[] = [];

    for (const caseId of caseIds) {
      const found = byId.get(caseId) ?? null;
      if (!found) {
        outcomes.push({
          caseId,
          result: "not_found",
          moderationCase: null,
          modLog: null,
        });
        continue;
      }

      // A legacy entry may show the DM as deleted already; the load stores that first.
      const entry = skip.has(caseId)
        ? null
        : await this.modLogMessageService.loadEntry(found);
      const moderationCase = entry?.moderationCase ?? found;

      const deletedAt = new Date();
      const result = await this.deleteOne(moderationCase, deletedBy, deletedAt);
      if (result !== "deleted") {
        outcomes.push({ caseId, result, moderationCase, modLog: null });
        continue;
      }

      const updated = moderationCase.withDmDeleted(deletedBy, deletedAt);
      const modLog = entry
        ? await this.modLogMessageService.refreshEntry(entry, updated)
        : null;
      outcomes.push({ caseId, result, moderationCase: updated, modLog });
    }

    return outcomes;
  }

  private async deleteOne(
    moderationCase: ModerationCase,
    deletedBy: string,
    deletedAt: Date,
  ): Promise<CaseDmDeletionResult> {
    if (moderationCase.dmDeleted) {
      return "already_deleted";
    }

    const channelId = moderationCase.dmResult?.channelId;
    const messageId = moderationCase.dmResult?.messageId;
    if (!channelId || !messageId) {
      return "no_dm";
    }

    const context = {
      guildId: moderationCase.guildId,
      caseId: moderationCase.caseId,
      channelId,
      messageId,
      deletedBy,
    };

    try {
      await this.dmNotificationService.deleteModerationDM(
        this.client,
        channelId,
        messageId,
      );
    } catch (err) {
      const alreadyGone =
        err instanceof DiscordAPIError &&
        GONE_ERROR_CODES.includes(Number(err.code));
      if (!alreadyGone) {
        // Per-case isolation: one failed delete shouldn't stop the others.
        this.logger.warn({ err, ...context }, "Failed to delete moderation DM");
        this.metrics.recordModLogEdit("dm_delete", "failed");
        return "failed";
      }
    }

    await this.modLogRepository.markDmDeleted(
      moderationCase.guildId,
      moderationCase.caseId,
      deletedBy,
      deletedAt,
    );

    this.metrics.recordModLogEdit("dm_delete", "ok");
    this.logger.info(context, "Deleted moderation DM");
    return "deleted";
  }
}
