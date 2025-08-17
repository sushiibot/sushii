import { type Client, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { DMNotificationService } from "../../shared/application/DMNotificationService";
import type { ModerationAction } from "../../shared/domain/entities/ModerationAction";
import {
  type DMResult,
  ModerationCase,
} from "../../shared/domain/entities/ModerationCase";
import type { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import { TempBan } from "../../shared/domain/entities/TempBan";
import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import type { TempBanRepository } from "../../shared/domain/repositories/TempBanRepository";
import type { ModLogService } from "../../shared/domain/services/ModLogService";
import {
  ActionType,
  actionTypeRequiresDiscordAction,
} from "../../shared/domain/value-objects/ActionType";
import type { DMPolicyService } from "./DMPolicyService";

// Constants
const DEFAULT_DELETE_MESSAGE_DAYS = 0 as const;

/**
 * Handles the execution pipeline for single moderation actions.
 * Extracted from ModerationService to follow Single Responsibility Principle.
 */
export class ModerationExecutionPipeline {
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly modLogRepository: ModLogRepository,
    private readonly tempBanRepository: TempBanRepository,
    private readonly modLogService: ModLogService,
    private readonly dmPolicyService: DMPolicyService,
    private readonly dmNotificationService: DMNotificationService,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  /**
   * Executes a single moderation action through a clear pipeline of stages.
   *
   * Pipeline stages:
   * 1. Create case and validate
   * 2. Send pre-action DM (for ban/kick actions)
   * 3. Execute Discord action
   * 4. Handle post-action tasks (temp bans, post-DMs, mod logs)
   */
  async execute(
    action: ModerationAction,
    finalActionType: ActionType,
    target: ModerationTarget,
    guildConfig: GuildConfig,
  ): Promise<Result<ModerationCase, string>> {
    this.logger.info(
      {
        originalActionType: action.actionType,
        finalActionType: finalActionType,
        targetId: target.id,
        executorId: action.executor.id,
        guildId: action.guildId,
      },
      "Executing moderation action pipeline",
    );

    try {
      // For actions that require DM before creation, handle it first
      let preDMResult: DMResult | null = null;
      if (action.shouldSendDMBeforeAction()) {
        const dmPolicy = await this.dmPolicyService.shouldSendDM(
          "before",
          action,
          target,
          guildConfig,
        );

        if (dmPolicy.should) {
          // For warnings, DM must succeed before creating case
          if (action.isWarnAction()) {
            preDMResult = await this.sendDM(
              action.guildId,
              "pre-case",
              action,
              target,
              guildConfig,
            );

            if (preDMResult.error) {
              return Err(`Failed to send warning DM: ${preDMResult.error}`);
            }
          }
        }
      }

      // 1. Create database records atomically
      const createResult = await this.createModerationRecord(
        action,
        finalActionType,
        target,
        preDMResult,
        guildConfig,
      );
      if (!createResult.ok) {
        return createResult;
      }

      const { caseId, moderationCase } = createResult.val;

      // 2. Execute external operations (outside transaction)
      let currentCase = moderationCase;

      // Send pre-action DM if needed (for ban/kick actions)
      // Warnings already have their DM result included in the case
      if (action.shouldSendDMBeforeAction() && !action.isWarnAction()) {
        currentCase = await this.handlePreActionDM(
          action,
          target,
          caseId,
          currentCase,
          guildConfig,
        );
      }

      // Execute Discord action
      const discordActionResult = await this.handleDiscordAction(
        action,
        target,
        finalActionType,
      );
      if (!discordActionResult.ok) {
        // If it failed, we need to delete the DM sent and case if they were created

        // Delete DM if it was sent
        if (
          currentCase.dmResult?.channelId &&
          currentCase.dmResult?.messageId
        ) {
          await this.dmNotificationService.deleteModerationDM(
            this.client,
            currentCase.dmResult.channelId,
            currentCase.dmResult.messageId,
          );
        }

        // Delete case
        await this.modLogRepository.delete(
          currentCase.guildId,
          currentCase.caseId,
        );

        return discordActionResult;
      }

      // Handle post-action tasks
      currentCase = await this.handleExternalPostActionTasks(
        action,
        target,
        finalActionType,
        caseId,
        currentCase,
        guildConfig,
      );

      this.logger.info(
        {
          originalActionType: action.actionType,
          finalActionType: finalActionType,
          targetId: target.id,
          executorId: action.executor.id,
          guildId: action.guildId,
          caseId: caseId,
        },
        "Moderation action executed successfully",
      );

      return Ok(currentCase);
    } catch (error) {
      this.logger.error(
        {
          err: error,
          actionType: finalActionType,
          targetId: target.id,
          guildId: action.guildId,
        },
        "Pipeline execution failed",
      );

      return Err(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Creates moderation record and temp ban records atomically in a focused transaction.
   * This ensures database consistency for the core moderation data.
   */
  private async createModerationRecord(
    action: ModerationAction,
    finalActionType: ActionType,
    target: ModerationTarget,
    preDMResult: DMResult | null,
    guildConfig: GuildConfig,
  ): Promise<
    Result<{ caseId: string; moderationCase: ModerationCase }, string>
  > {
    // Determine DM intent before creating the case
    const dmPolicyDecision = await this.dmPolicyService.shouldSendDM(
      action.shouldSendDMBeforeAction() ? "before" : "after",
      action,
      target,
      guildConfig,
    );
    return await this.db.transaction(
      async (tx: NodePgDatabase<typeof schema>) => {
        // Should not be pending for note or warn
        // Only pending for actions that create an audit-log event
        const isPending =
          finalActionType !== ActionType.Note &&
          finalActionType !== ActionType.Warn;

        // Extract timeout duration in seconds if applicable
        let timeoutDuration: number | null = null;
        if (action.isTimeoutAction()) {
          timeoutDuration = action.duration.asSeconds();
        }

        // Create moderation case with DM intent
        // Use placeholder case ID - createCase() will auto-generate the real ID
        let moderationCase = ModerationCase.create(
          action.guildId,
          "placeholder",
          finalActionType,
          target.id,
          target.tag,
          action.executor.id,
          action.reason,
          undefined,
          action.attachment ? [action.attachment.url] : [],
          timeoutDuration,
        )
          .withPending(isPending)
          .withDMIntent(
            dmPolicyDecision.should,
            dmPolicyDecision.source,
            !target.member && dmPolicyDecision.should
              ? "user_not_in_guild"
              : undefined,
          );

        // Include pre-sent DM result if provided
        if (preDMResult) {
          moderationCase = moderationCase.withDMResult(preDMResult);
        }

        // Create moderation case with auto-generated case ID
        const createCaseResult = await this.modLogRepository.createCase(
          moderationCase,
          tx,
        );

        if (!createCaseResult.ok) {
          this.logger.error(
            {
              actionType: action.actionType,
              targetId: target.id,
              error: createCaseResult.val,
            },
            "Failed to create moderation case",
          );
          throw new Error(createCaseResult.val);
        }

        // Handle temp ban records atomically
        const tempBanResult = await this.manageTempBanRecords(
          action,
          target,
          tx,
        );

        if (!tempBanResult.ok) {
          this.logger.error(
            {
              actionType: finalActionType,
              targetId: target.id,
              guildId: action.guildId,
              error: tempBanResult.val,
            },
            "Failed to manage temp ban records",
          );
          throw new Error(tempBanResult.val);
        }

        // Use the created case with auto-generated ID
        const createdCase = createCaseResult.val;
        return Ok({ caseId: createdCase.caseId, moderationCase: createdCase });
      },
    );
  }

  /**
   * Handles pre-action DM delivery (simplified version without context)
   */
  private async handlePreActionDM(
    action: ModerationAction,
    target: ModerationTarget,
    caseId: string,
    moderationCase: ModerationCase,
    guildConfig: GuildConfig,
  ): Promise<ModerationCase> {
    // Check if we should send DM based on the stored intent
    if (!moderationCase.dmIntended || moderationCase.dmNotAttemptedReason) {
      return moderationCase;
    }

    // For actions that don't require pre-action DM, skip
    if (!action.shouldSendDMBeforeAction()) {
      return moderationCase;
    }

    const dmResult = await this.sendDM(
      action.guildId,
      caseId,
      action,
      target,
      guildConfig,
    );
    const updatedCase = moderationCase.withDMResult(dmResult);

    // Update case with DM result in separate small transaction
    await this.updateCaseWithDMResult(updatedCase);

    return updatedCase;
  }

  /**
   * Handles Discord action execution (simplified version without context)
   */
  private async handleDiscordAction(
    action: ModerationAction,
    target: ModerationTarget,
    finalActionType: ActionType,
  ): Promise<Result<void, string>> {
    if (!actionTypeRequiresDiscordAction(finalActionType)) {
      return Ok.EMPTY; // Nothing to do for actions like Warn or Note
    }

    const discordResult = await this.performDiscordAction(
      action.guildId,
      action,
      target,
      finalActionType,
    );

    if (!discordResult.ok) {
      this.logger.error(
        {
          actionType: finalActionType,
          targetId: target.id,
          executorId: action.executor.id,
          guildId: action.guildId,
          error: discordResult.val,
        },
        "Failed to execute Discord action",
      );

      return discordResult;
    }

    return Ok.EMPTY;
  }

  /**
   * Handles post-action tasks (simplified version without context)
   */
  private async handleExternalPostActionTasks(
    action: ModerationAction,
    target: ModerationTarget,
    finalActionType: ActionType,
    caseId: string,
    moderationCase: ModerationCase,
    guildConfig: GuildConfig,
  ): Promise<ModerationCase> {
    // Send post-action DM (may update context)
    const currentCase = await this.handlePostActionDM(
      action,
      target,
      caseId,
      moderationCase,
      guildConfig,
    );

    // Send mod log for Warn/Note actions
    await this.sendModLogForAction(
      action,
      target,
      finalActionType,
      currentCase,
    );

    return currentCase;
  }

  /**
   * Handles post-action DM delivery
   */
  private async handlePostActionDM(
    action: ModerationAction,
    target: ModerationTarget,
    caseId: string,
    moderationCase: ModerationCase,
    guildConfig: GuildConfig,
  ): Promise<ModerationCase> {
    // Check if we should send DM based on the stored intent
    if (!moderationCase.dmIntended || moderationCase.dmNotAttemptedReason) {
      return moderationCase;
    }

    // For actions that require pre-action DM, skip post-action DM
    if (action.shouldSendDMBeforeAction()) {
      return moderationCase;
    }

    const dmResult = await this.sendDM(
      action.guildId,
      caseId,
      action,
      target,
      guildConfig,
    );
    const updatedCase = moderationCase.withDMResult(dmResult);

    // Update case with DM result in separate small transaction
    await this.updateCaseWithDMResult(updatedCase);

    return updatedCase;
  }

  /**
   * Sends mod log if needed for the action
   */
  private async sendModLogForAction(
    action: ModerationAction,
    target: ModerationTarget,
    finalActionType: ActionType,
    moderationCase: ModerationCase,
  ): Promise<void> {
    if (this.modLogService.shouldPostToModLog(finalActionType)) {
      const modLogResult = await this.modLogService.sendModLog(
        action.guildId,
        finalActionType,
        target,
        moderationCase,
      );

      if (!modLogResult.ok) {
        this.logger.warn(
          {
            actionType: finalActionType,
            targetId: target.id,
            guildId: action.guildId,
            error: modLogResult.val,
          },
          "Failed to send mod log",
        );
        // Don't fail the operation, just log the warning
      }
    }
  }

  /**
   * Updates case with DM result in a separate focused transaction
   */
  private async updateCaseWithDMResult(
    moderationCase: ModerationCase,
  ): Promise<void> {
    await this.db.transaction(async (tx: NodePgDatabase<typeof schema>) => {
      const updateResult = await this.modLogRepository.update(
        moderationCase,
        tx,
      );
      if (!updateResult.ok) {
        this.logger.warn(
          {
            caseId: moderationCase.caseId,
            error: updateResult.val,
          },
          "Failed to update case with DM result",
        );
      }
    });
  }

  /**
   * Manages temporary ban database records with transaction support.
   */
  private async manageTempBanRecords(
    action: ModerationAction,
    target: ModerationTarget,
    tx: NodePgDatabase<typeof schema>,
  ): Promise<Result<void, string>> {
    switch (action.actionType) {
      case ActionType.TempBan: {
        if (!action.isTempBanAction()) {
          return Err("Invalid action type for temp ban database operation");
        }

        // Create temp ban record with expiration time
        const expiresAt = action.duration.endTime();
        const tempBan = TempBan.create(target.id, action.guildId, expiresAt);

        const saveResult = await this.tempBanRepository.save(tempBan, tx);
        if (!saveResult.ok) {
          return Err(`Failed to save temp ban: ${saveResult.val}`);
        }

        this.logger.info(
          {
            userId: target.id,
            guildId: action.guildId,
            expiresAt: expiresAt.toISOString(),
          },
          "Created temp ban database record",
        );
        break;
      }

      case ActionType.BanRemove: {
        // Delete temp ban record if it exists (user might have been manually unbanned)
        const deleteResult = await this.tempBanRepository.delete(
          action.guildId,
          target.id,
          tx,
        );
        if (!deleteResult.ok) {
          return Err(`Failed to delete temp ban: ${deleteResult.val}`);
        }

        if (deleteResult.val) {
          this.logger.info(
            {
              userId: target.id,
              guildId: action.guildId,
            },
            "Deleted temp ban database record",
          );
        } else {
          this.logger.debug(
            {
              userId: target.id,
              guildId: action.guildId,
            },
            "No temp ban record found to delete",
          );
        }
        break;
      }

      default:
        // No temp ban database operations needed for other action types
        break;
    }

    return Ok.EMPTY;
  }

  /**
   * Helper method to send DM to target user using the DM notification service.
   */
  private async sendDM(
    guildId: string,
    caseId: string,
    action: ModerationAction,
    target: ModerationTarget,
    guildConfig: GuildConfig,
  ): Promise<{ channelId?: string; messageId?: string; error?: string }> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return { error: "Guild not found" };
    }

    // Determine duration end time for temporal actions
    const durationEnd = action.isTemporalAction()
      ? action.duration.endTime()
      : null;

    // Use the DM notification service with guild config for custom messages
    const dmResult = await this.dmNotificationService.sendModerationDM(
      target.user,
      guild,
      action.actionType,
      true, // should DM reason - this is handled by DMPolicyService
      action.reason,
      durationEnd,
      guildConfig,
    );

    if (!dmResult.ok) {
      this.logger.warn(
        {
          caseId: caseId.toString(),
          targetId: target.id,
          error: dmResult.val,
        },
        "Failed to send DM via notification service",
      );

      return {
        error: dmResult.val,
      };
    }

    const dmSentResult = dmResult.val;

    this.logger.info(
      {
        caseId: caseId.toString(),
        targetId: target.id,
        messageId: dmSentResult.messageId,
        channelId: dmSentResult.channelId,
      },
      "DM sent successfully via notification service",
    );

    return {
      channelId: dmSentResult.channelId || undefined,
      messageId: dmSentResult.messageId || undefined,
      error: dmSentResult.error || undefined,
    };
  }

  /**
   * Helper method to execute Discord actions based on action type.
   */
  private async performDiscordAction(
    guildId: string,
    action: ModerationAction,
    target: ModerationTarget,
    actionType: ActionType,
  ): Promise<Result<void, string>> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return Err("Guild not found");
    }

    let reason = `By ${action.executor.username}`;
    if (action.reason?.value) {
      reason += `: ${action.reason.value}`;
    }

    try {
      switch (actionType) {
        case ActionType.Ban: {
          if (!action.isBanAction()) {
            return Err("Invalid action type for ban operation");
          }
          await guild.members.ban(target.id, {
            reason,
            deleteMessageSeconds:
              (action.deleteMessageDays || DEFAULT_DELETE_MESSAGE_DAYS) *
              24 *
              60 *
              60,
          });

          break;
        }

        case ActionType.TempBan: {
          if (!action.isTempBanAction()) {
            return Err("Invalid action type for temp ban operation");
          }

          await guild.members.ban(target.id, {
            reason: reason,
            deleteMessageDays:
              action.deleteMessageDays || DEFAULT_DELETE_MESSAGE_DAYS,
          });
          break;
        }

        case ActionType.BanRemove: {
          try {
            await guild.members.unban(target.id, reason);
          } catch (error) {
            // Check if the error is because the user is not banned for clearer
            // error for executor
            if (
              error instanceof DiscordAPIError &&
              error.code === RESTJSONErrorCodes.UnknownBan
            ) {
              return Err("User is not banned");
            }

            // Re-throw other errors
            throw error;
          }
          break;
        }

        case ActionType.Kick: {
          if (!target.member) {
            return Err("Cannot kick a user who is not in the guild");
          }
          await target.member.kick(reason);
          break;
        }

        case ActionType.Timeout: {
          if (!target.member) {
            return Err("Cannot timeout a user who is not in the guild");
          }
          if (!action.isTimeoutAction()) {
            return Err("Invalid action type for timeout operation");
          }
          await target.member.timeout(
            action.duration.value.asMilliseconds(),
            reason,
          );
          break;
        }

        case ActionType.TimeoutAdjust: {
          if (!target.member) {
            return Err("Cannot timeout a user who is not in the guild");
          }
          if (!action.isTimeoutAction()) {
            return Err("Invalid action type for timeout operation");
          }
          await target.member.timeout(
            action.duration.value.asMilliseconds(),
            reason,
          );
          break;
        }

        case ActionType.TimeoutRemove: {
          if (!target.member) {
            return Err(
              "Cannot remove timeout from a user who is not in the guild",
            );
          }

          // Check if user is currently timed out
          const currentTimeout = target.member.communicationDisabledUntil;
          const isTimedOut =
            currentTimeout && currentTimeout.getTime() > Date.now();

          if (!isTimedOut) {
            return Err("User is not currently timed out");
          }

          await target.member.timeout(null, reason);
          break;
        }

        default:
          break;
      }

      this.logger.info(
        {
          actionType: actionType,
          targetId: target.id,
          guildId,
        },
        "Discord action executed successfully",
      );

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error(
        {
          actionType: actionType,
          targetId: target.id,
          guildId,
          err: error,
        },
        "Failed to execute Discord action",
      );

      // Handle common errors cases for clearer user facing errors
      if (error instanceof DiscordAPIError) {
        switch (error.code) {
          case RESTJSONErrorCodes.MissingPermissions:
            return Err(
              "Bot is missing permissions. Please check the bot's role and permissions.",
            );
        }
      }

      return Err(error instanceof Error ? error.message : String(error));
    }
  }
}
