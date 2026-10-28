import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type {
  DMEditOutcome,
  DMNotificationService,
} from "../../shared/application/DMNotificationService";
import type {
  ModLogMessageService,
  ModLogRefreshOutcome,
} from "../../shared/application/ModLogMessageService";
import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModerationMetrics } from "../../shared/domain/metrics/ModerationMetrics";
import { NOOP_MODERATION_METRICS } from "../../shared/domain/metrics/ModerationMetrics";
import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import { CaseRange } from "../../shared/domain/value-objects/CaseRange";

export interface ReasonUpdateResult {
  updatedCases: ModerationCase[];
  errors: ReasonUpdateError[];
  /** One entry per updated case when updateDm was set, otherwise empty. */
  dmUpdates: ReasonDmUpdate[];
  modLogUpdates: ReasonModLogUpdate[];
}

export interface ReasonDmUpdate {
  caseId: string;
  /**
   * `skipped_unverified`: the posted entry couldn't be loaded, so an old
   * entry showing the DM as deleted can't be ruled out; the DM is left alone.
   */
  outcome: DMEditOutcome | "skipped_unverified";
}

export interface ReasonModLogUpdate {
  caseId: string;
  /** `skipped` when the caller re-renders the entry itself. */
  outcome: ModLogRefreshOutcome | "skipped";
}

export interface ReasonUpdateError {
  caseId: string;
  errorType: "msg_missing" | "msg_fetch" | "not_configured";
  message: string;
}

export interface ReasonUpdateOptions {
  guildId: string;
  executorId: string;
  caseRangeStr: string;
  reason: string;
  onlyEmpty: boolean;
  /** Also edit each case's DM to show the new reason. */
  updateDm?: boolean;
  /** Case IDs whose mod log message the caller re-renders itself, e.g. with interaction.update(). */
  skipModLogRefreshFor?: readonly string[];
}

export class ReasonUpdateService {
  constructor(
    private readonly modLogRepository: ModLogRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly client: Client,
    private readonly dmNotificationService: Pick<
      DMNotificationService,
      "editCaseDM"
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

  async checkExistingReasons(
    guildId: string,
    caseRangeStr: string,
  ): Promise<
    Result<{ cases: ModerationCase[]; hasExistingReasons: boolean }, string>
  > {
    // Parse the case range
    const caseRangeResult = CaseRange.fromString(caseRangeStr);
    if (caseRangeResult.err) {
      return caseRangeResult;
    }

    const caseRange = caseRangeResult.val;

    // Validate the affected count
    const affectedCount = caseRange.getAffectedCount();
    if (!affectedCount) {
      return Err("Please specify the end case ID");
    }

    if (affectedCount > 25) {
      return Err("You can only modify up to 25 cases at a time");
    }

    // Get the next case number to resolve "latest" ranges
    const getCurrentCaseNumber = async () => {
      // Get the latest case to determine the current max case number
      const [latestCase] = await this.modLogRepository.findRecent(guildId, 1);
      return latestCase ? Number(latestCase.caseId) + 1 : 1;
    };

    // Resolve the case range to actual case IDs
    const resolvedRangeResult =
      await caseRange.resolveToRange(getCurrentCaseNumber);
    if (resolvedRangeResult.err) {
      return resolvedRangeResult;
    }

    const [startCaseId, endCaseId] = resolvedRangeResult.val;

    // Fetch all cases in the range
    const cases = await this.modLogRepository.findByRange(
      guildId,
      startCaseId,
      endCaseId,
    );
    const hasExistingReasons = cases.some((c) => c.reason !== null);

    return Ok({ cases, hasExistingReasons });
  }

  async updateReasons(
    options: ReasonUpdateOptions,
  ): Promise<Result<ReasonUpdateResult, string>> {
    const { guildId, executorId, caseRangeStr, reason, onlyEmpty } = options;

    this.logger.debug(
      { guildId, caseRangeStr, onlyEmpty, updateDm: options.updateDm },
      "Starting reason update",
    );

    const caseRangeResult = CaseRange.fromString(caseRangeStr);
    if (caseRangeResult.err) {
      return caseRangeResult;
    }

    const getCurrentCaseNumber = async () => {
      const [latestCase] = await this.modLogRepository.findRecent(guildId, 1);
      return latestCase ? Number(latestCase.caseId) + 1 : 1;
    };

    const resolvedRangeResult =
      await caseRangeResult.val.resolveToRange(getCurrentCaseNumber);
    if (resolvedRangeResult.err) {
      return resolvedRangeResult;
    }

    const [startCaseId, endCaseId] = resolvedRangeResult.val;

    const updatedCases = await this.modLogRepository.updateReasonBulk(
      guildId,
      executorId,
      startCaseId,
      endCaseId,
      reason,
      onlyEmpty,
    );

    const result: ReasonUpdateResult = {
      updatedCases: [],
      errors: [],
      dmUpdates: [],
      modLogUpdates: [],
    };
    if (updatedCases.length === 0) {
      return Ok(result);
    }

    const guildConfig = options.updateDm
      ? await this.guildConfigRepository.findByGuildId(guildId)
      : null;
    const skip = new Set(options.skipModLogRefreshFor ?? []);

    for (const updatedCase of updatedCases) {
      // Loaded before the DM edit: a legacy entry may show the DM as deleted.
      const entry = skip.has(updatedCase.caseId)
        ? null
        : await this.modLogMessageService.loadEntry(updatedCase);
      const modCase = entry?.moderationCase ?? updatedCase;
      result.updatedCases.push(modCase);

      if (guildConfig) {
        const unverified =
          !!modCase.msgId &&
          (entry?.missing === "not_configured" || entry?.missing === "failed");
        const dmOutcome = unverified
          ? "skipped_unverified"
          : await this.dmNotificationService.editCaseDM(
              this.client,
              modCase,
              guildConfig,
            );
        if (dmOutcome === "updated" || dmOutcome === "failed") {
          this.metrics.recordModLogEdit(
            "dm_edit",
            dmOutcome === "updated" ? "ok" : "failed",
          );
        }
        result.dmUpdates.push({ caseId: modCase.caseId, outcome: dmOutcome });
      }

      const outcome = entry
        ? await this.modLogMessageService.refreshEntry(entry, modCase)
        : "skipped";
      result.modLogUpdates.push({ caseId: modCase.caseId, outcome });

      const error = toReasonUpdateError(modCase.caseId, outcome);
      if (
        error &&
        !result.errors.some((e) => e.errorType === "not_configured")
      ) {
        result.errors.push(error);
      }
    }

    return Ok(result);
  }
}

function toReasonUpdateError(
  caseId: string,
  outcome: ModLogRefreshOutcome | "skipped",
): ReasonUpdateError | null {
  switch (outcome) {
    case "no_message":
      return {
        caseId,
        errorType: "msg_missing",
        message: "Mod log message ID not found",
      };
    case "failed":
      return {
        caseId,
        errorType: "msg_fetch",
        message: "Could not fetch or update mod log message",
      };
    case "not_configured":
      return {
        caseId: "all",
        errorType: "not_configured",
        message: "Mod log is not configured or disabled",
      };
    default:
      return null;
  }
}
