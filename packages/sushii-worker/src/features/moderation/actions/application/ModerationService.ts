import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";
import { Result } from "ts-results";

import * as schema from "@/infrastructure/database/schema";

import { ModerationAction } from "../../shared/domain/entities/ModerationAction";
import { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import { PermissionValidationService } from "../../shared/domain/services/PermissionValidationService";
import { TimeoutDetectionService } from "../../shared/domain/services/TimeoutDetectionService";
import { ModerationExecutionPipeline } from "./ModerationExecutionPipeline";

export class ModerationService {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly permissionService: PermissionValidationService,
    private readonly timeoutDetectionService: TimeoutDetectionService,
    private readonly executionPipeline: ModerationExecutionPipeline,
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

    const actionResults: Result<ModerationCase, string>[] = [];

    // Process each target sequentially to avoid race conditions
    for (const target of targets) {
      const result = await this.executeActionSingle(action, target);
      actionResults.push(result);
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
    );
  }
}
