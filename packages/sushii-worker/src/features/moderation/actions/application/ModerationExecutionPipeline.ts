import { type Client, DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { PermissionUsageRecorder } from "@/features/permission-audit";
import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { DMNotificationService } from "../../shared/application/DMNotificationService";
import type { ModLogMessageService } from "../../shared/application/ModLogMessageService";
import type { SoftbanSuppressionSet } from "../../shared/application/SoftbanSuppressionSet";
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
  actionTypePermission,
  actionTypeRequiresDiscordAction,
} from "../../shared/domain/value-objects/ActionType";
import type { DMPolicyService } from "./DMPolicyService";

// Constants
const DEFAULT_DELETE_MESSAGE_DAYS = 0;

const AUDIT_LOG_REASON_MAX_LENGTH = 512;

// Discord rejects or cuts audit log reasons over 512 chars; the full reason stays in the case.
export function buildAuditLogReason(
  executorUsername: string,
  reason: string | null,
  caseId: string,
): string {
  const prefix = `By ${executorUsername}`;
  if (!reason) {
    return prefix;
  }

  const full = `${prefix}: ${reason}`;
  if (full.length <= AUDIT_LOG_REASON_MAX_LENGTH) {
    return full;
  }

  const suffix = `… (full reason in case #${caseId})`;
  return full.slice(0, AUDIT_LOG_REASON_MAX_LENGTH - suffix.length) + suffix;
}

/**
 * User-facing message for expected Discord API rejections, or null if the
 * error is unexpected.
 */
function discordErrorMessage(error: unknown): string | null {
  if (!(error instanceof DiscordAPIError)) {
    return null;
  }

  switch (error.code) {
    case RESTJSONErrorCodes.MissingPermissions:
      return "Bot is missing permissions. Please check the bot's role and permissions.";
    case RESTJSONErrorCodes.MissingAccess:
      return "Bot is missing access. Please check the bot's role and permissions.";
    case RESTJSONErrorCodes.UnknownUser:
      return "User not found";
    case RESTJSONErrorCodes.UnknownMember:
      return "User is not in the server";
    default:
      return null;
  }
}

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
    private readonly softbanSuppressionSet: SoftbanSuppressionSet,
    private readonly permissionUsageRecorder: PermissionUsageRecorder,
    private readonly modLogMessageService: Pick<
      ModLogMessageService,
      "refresh"
    >,
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

          if (preDMResult !== null && preDMResult.error) {
            // Only known failure reasons carry a user-facing message; others
            // may be raw exception text
            return Err(
              preDMResult.failureReason &&
                preDMResult.failureReason !== "unknown"
                ? `Failed to send warning DM: ${preDMResult.error}`
                : "Failed to send warning DM",
            );
          }
        }
      }
    }

    // 1. Create database records atomically
    const { caseId, moderationCase } = await this.createModerationRecord(
      action,
      finalActionType,
      target,
      preDMResult,
      guildConfig,
    );

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
    // If the Discord action fails, compensate by removing the DM and case
    let discordActionResult: Result<void, string>;
    try {
      discordActionResult = await this.handleDiscordAction(
        action,
        target,
        finalActionType,
        caseId,
      );
    } catch (err) {
      const caseToRollBack = currentCase;
      await this.rollbackCase(caseToRollBack).catch((rollbackErr: unknown) => {
        this.logger.error(
          {
            err: rollbackErr,
            guildId: caseToRollBack.guildId,
            caseId: caseToRollBack.caseId,
          },
          "Failed to roll back case after Discord action error",
        );
      });
      throw err;
    }

    if (!discordActionResult.ok) {
      await this.rollbackCase(currentCase);
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

    const permission = actionTypePermission(finalActionType);
    if (permission) {
      await this.permissionUsageRecorder.recordSushiiAction({
        guildId: action.guildId,
        userId: action.executor.id,
        permission,
        channelId: null,
      });
    }

    return Ok(currentCase);
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
  ): Promise<{ caseId: string; moderationCase: ModerationCase }> {
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

        // Extract action-specific duration fields
        const timeoutDuration = action.isTemporalAction()
          ? action.duration.asSeconds()
          : null;

        const deleteMessageSeconds = action.isSoftbanAction()
          ? action.deleteMessageSeconds
          : null;

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
          deleteMessageSeconds,
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
        const createdCase = await this.modLogRepository.createCase(
          moderationCase,
          tx,
        );

        // Handle temp ban records atomically
        await this.manageTempBanRecords(action, target, tx);

        return { caseId: createdCase.caseId, moderationCase: createdCase };
      },
    );
  }

  /**
   * Removes the DM (best effort) and case created for an action whose Discord
   * step failed.
   */
  private async rollbackCase(moderationCase: ModerationCase): Promise<void> {
    const { channelId, messageId } = moderationCase.dmResult ?? {};
    if (channelId && messageId) {
      try {
        await this.dmNotificationService.deleteModerationDM(
          this.client,
          channelId,
          messageId,
        );
      } catch (err) {
        this.logger.warn(
          {
            err,
            guildId: moderationCase.guildId,
            caseId: moderationCase.caseId,
          },
          "Failed to delete moderation DM during rollback",
        );
      }
    }

    await this.modLogRepository.delete(
      moderationCase.guildId,
      moderationCase.caseId,
    );
  }

  /**
   * Handles pre-action DM delivery
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

    if (dmResult === null) {
      return moderationCase;
    }

    const updatedCase = moderationCase.withDMResult(dmResult);

    // Update case with DM result
    await this.modLogRepository.updateDMInfo(
      updatedCase.guildId,
      updatedCase.caseId,
      updatedCase.dmResult ?? {},
      updatedCase.dmAttempted,
      updatedCase.dmIntended,
      updatedCase.dmFailureReason,
    );
    await this.refreshPostedEntry(updatedCase.guildId, updatedCase.caseId);

    return updatedCase;
  }

  /**
   * Handles Discord action execution
   */
  private async handleDiscordAction(
    action: ModerationAction,
    target: ModerationTarget,
    finalActionType: ActionType,
    caseId: string,
  ): Promise<Result<void, string>> {
    if (!actionTypeRequiresDiscordAction(finalActionType)) {
      return Ok.EMPTY; // Nothing to do for actions like Warn or Note
    }

    const discordResult = await this.performDiscordAction(
      action.guildId,
      action,
      target,
      finalActionType,
      caseId,
    );

    if (!discordResult.ok) {
      this.logger.warn(
        {
          actionType: finalActionType,
          targetId: target.id,
          executorId: action.executor.id,
          guildId: action.guildId,
          reason: discordResult.val,
        },
        "Discord action not executed",
      );

      return discordResult;
    }

    return Ok.EMPTY;
  }

  /**
   * Handles post-action tasks
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

    if (dmResult === null) {
      return moderationCase;
    }

    const updatedCase = moderationCase.withDMResult(dmResult);

    // Update case with DM result
    await this.modLogRepository.updateDMInfo(
      updatedCase.guildId,
      updatedCase.caseId,
      updatedCase.dmResult ?? {},
      updatedCase.dmAttempted,
      updatedCase.dmIntended,
      updatedCase.dmFailureReason,
    );
    await this.refreshPostedEntry(updatedCase.guildId, updatedCase.caseId);

    return updatedCase;
  }

  /**
   * The audit log post can land before the DM result is saved; re-render the
   * entry from the current row if it's already posted.
   */
  private async refreshPostedEntry(
    guildId: string,
    caseId: string,
  ): Promise<void> {
    try {
      const current = await this.modLogRepository.findById(guildId, caseId);
      if (current?.msgId) {
        await this.modLogMessageService.refresh(current);
      }
    } catch (err) {
      this.logger.warn(
        { err, guildId, caseId },
        "Failed to refresh mod log entry after the DM result",
      );
    }
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
      } else {
        // Save the message ID to the database
        // Best effort: the action already happened, so a failure here must
        // not report the action as failed
        const messageId = modLogResult.val;
        try {
          await this.modLogRepository.updateMessageId(
            action.guildId,
            moderationCase.caseId,
            messageId,
          );
        } catch (err) {
          this.logger.warn(
            {
              err,
              actionType: finalActionType,
              targetId: target.id,
              guildId: action.guildId,
              caseId: moderationCase.caseId,
              messageId,
            },
            "Failed to save mod log message ID to database",
          );
          return;
        }

        this.logger.debug(
          {
            actionType: finalActionType,
            targetId: target.id,
            guildId: action.guildId,
            caseId: moderationCase.caseId,
            messageId,
          },
          "Successfully saved mod log message ID to database",
        );
      }
    }
  }

  /**
   * Manages temporary ban database records with transaction support.
   */
  private async manageTempBanRecords(
    action: ModerationAction,
    target: ModerationTarget,
    tx: NodePgDatabase<typeof schema>,
  ): Promise<void> {
    switch (action.actionType) {
      case ActionType.TempBan: {
        if (!action.isTempBanAction()) {
          throw new Error(
            "Invalid action type for temp ban database operation",
          );
        }

        // Create temp ban record with expiration time
        const expiresAt = action.duration.endTime();
        const tempBan = TempBan.create(target.id, action.guildId, expiresAt);

        await this.tempBanRepository.save(tempBan, tx);

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

      case ActionType.BanRemove:
      case ActionType.Softban: {
        const deletedTempBan = await this.tempBanRepository.delete(
          action.guildId,
          target.id,
          tx,
        );

        if (deletedTempBan) {
          this.logger.info(
            {
              userId: target.id,
              guildId: action.guildId,
              actionType: action.actionType,
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
  ): Promise<DMResult | null> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return null;
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
        "DM not sent via notification service (action type not supported or pre-send guard)",
      );

      return null;
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
      failureReason: dmSentResult.failureReason ?? undefined,
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
    caseId: string,
  ): Promise<Result<void, string>> {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      return Err("Guild not found");
    }

    const reason = buildAuditLogReason(
      action.executor.username,
      action.reason?.value ?? null,
      caseId,
    );

    try {
      switch (actionType) {
        case ActionType.Ban: {
          if (!action.isBanAction()) {
            throw new Error("Invalid action type for ban operation");
          }
          await guild.members.ban(target.id, {
            reason,
            deleteMessageSeconds:
              action.deleteMessageSeconds ??
              (action.deleteMessageDays ?? DEFAULT_DELETE_MESSAGE_DAYS) *
                24 *
                60 *
                60,
          });

          break;
        }

        case ActionType.TempBan: {
          if (!action.isTempBanAction()) {
            throw new Error("Invalid action type for temp ban operation");
          }

          await guild.members.ban(target.id, {
            reason: reason,
            deleteMessageDays:
              action.deleteMessageDays ?? DEFAULT_DELETE_MESSAGE_DAYS,
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

        case ActionType.Softban: {
          if (!action.isSoftbanAction()) {
            throw new Error("Invalid action type for softban operation");
          }
          await guild.members.ban(target.id, {
            reason,
            deleteMessageSeconds: action.deleteMessageSeconds,
          });
          // Suppress before unban — covers the BanRemove audit log event that Discord
          // emits asynchronously after the HTTP unban completes (gateway delivery delay
          // can be several seconds). TTL auto-expires after 60s.
          this.softbanSuppressionSet.suppress(guildId, target.id);
          try {
            await guild.members.unban(target.id, reason);
          } catch (unbanError) {
            // UnknownBan means the user is already not banned — desired end state.
            // Release suppression: if someone else unbanned them, their BanRemove
            // audit log is not ours to suppress.
            if (
              unbanError instanceof DiscordAPIError &&
              unbanError.code === RESTJSONErrorCodes.UnknownBan
            ) {
              this.softbanSuppressionSet.release(guildId, target.id);
              break;
            }
            // For other failures: release suppression so a moderator's manual unban
            // attempt is not silently swallowed by the TTL window.
            this.softbanSuppressionSet.release(guildId, target.id);
            this.logger.error(
              {
                err: unbanError,
                guildId,
                targetId: target.id,
              },
              "Softban unban step failed — user remains banned, suppression released",
            );
            throw unbanError;
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
            throw new Error("Invalid action type for timeout operation");
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
            throw new Error("Invalid action type for timeout operation");
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
      // Map expected Discord rejections to clear user-facing errors; anything
      // else is unexpected and propagates
      const userMessage = discordErrorMessage(error);
      if (!userMessage) {
        throw error;
      }

      this.logger.warn(
        {
          actionType: actionType,
          targetId: target.id,
          guildId,
          err: error,
        },
        "Discord rejected moderation action",
      );

      return Err(userMessage);
    }
  }
}
