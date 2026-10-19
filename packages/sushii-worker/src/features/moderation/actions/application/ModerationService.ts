import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ModerationAction } from "../../shared/domain/entities/ModerationAction";
import type { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import type { PermissionValidationService } from "../../shared/domain/services/PermissionValidationService";
import type { TimeoutDetectionService } from "../../shared/domain/services/TimeoutDetectionService";
import type { ModerationExecutionPipeline } from "./ModerationExecutionPipeline";

export const UNEXPECTED_TARGET_ERROR =
  "Something went wrong, please try again later.";

export class ModerationService {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly permissionService: PermissionValidationService,
    private readonly timeoutDetectionService: TimeoutDetectionService,
    private readonly executionPipeline: ModerationExecutionPipeline,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Enhanced executeAction with permission validation, timeout detection,
   * and focused transaction boundaries for database operations only.
   */
  async executeAction(
    action: ModerationAction,
    targets: ModerationTarget[],
  ): Promise<Result<ModerationCase, string>[]> {
    this.logger.info(
      {
        actionType: action.actionType,
        targetCount: targets.length,
        executorId: action.executor.id,
        guildId: action.guildId,
      },
      "Executing batch moderation actions",
    );

    // Fetch guild config once for all targets in this batch
    const guildConfig = await this.guildConfigRepository.findByGuildId(
      action.guildId,
    );

    const actionResults: Result<ModerationCase, string>[] = [];

    // Process each target sequentially to avoid race conditions
    for (const target of targets) {
      // Isolate per-target failures so one unexpected error does not abort
      // the rest of the batch; the moderator sees a generic per-target error
      try {
        const result = await this.executeActionSingle(
          action,
          target,
          guildConfig,
        );
        actionResults.push(result);
      } catch (err) {
        this.logger.error(
          {
            err,
            actionType: action.actionType,
            targetId: target.id,
            executorId: action.executor.id,
            guildId: action.guildId,
          },
          "Moderation action failed for target",
        );
        actionResults.push(Err(UNEXPECTED_TARGET_ERROR));
      }
    }

    return actionResults;
  }

  /**
   * Enhanced executeActionSingle with permission validation and timeout detection.
   *
   * Execution flow:
   * 1. Validate permissions for the action
   * 2. Detect timeout adjustments and correct action type
   * 3. Execute moderation pipeline with focused transaction boundaries
   *
   * @param action - The moderation action to execute
   * @param target - The target user for the action
   * @returns Result containing the final moderation case or error message
   */
  private async executeActionSingle(
    action: ModerationAction,
    target: ModerationTarget,
    guildConfig: GuildConfig,
  ): Promise<Result<ModerationCase, string>> {
    // 1. Permission validation
    const permissionResult = await this.permissionService.canTargetUser(
      action.executor,
      action.executorMember,
      target.user,
      target.member,
      action.actionType,
    );
    if (!permissionResult.ok) {
      return permissionResult;
    }

    // 2. Detect timeout adjustments and correct action type
    const correctedActionType =
      this.timeoutDetectionService.determineTimeoutActionType(
        action.actionType,
        target,
      );

    // Use the corrected action type for this execution
    const finalActionType = correctedActionType;

    return await this.executionPipeline.execute(
      action,
      finalActionType,
      target,
      guildConfig,
    );
  }
}
