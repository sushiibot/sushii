import type { Guild, GuildAuditLogsEntry, User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { DMResult } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { ActionType } from "../../shared";
import { AuditLogEvent } from "../domain/entities";
import type { ModLogPostingService } from "./ModLogPostingService";
import type {
  DMSentResult,
  NativeTimeoutDMService,
} from "./NativeTimeoutDMService";

/**
 * Application service for handling Discord audit log events end-to-end.
 * Orchestrates the complete workflow from audit log entry to mod log posting.
 */
export class AuditLogService {
  constructor(
    private readonly modLogRepository: ModLogRepository,
    private readonly nativeTimeoutDMService: NativeTimeoutDMService,
    private readonly modLogPostingService: ModLogPostingService,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Handles the complete audit log processing workflow.
   * This is the main entry point that orchestrates all steps.
   */
  async handleAuditLogEntry(
    entry: GuildAuditLogsEntry,
    guild: Guild,
  ): Promise<Result<void, string>> {
    try {
      // Step 1: Convert audit log entry to moderation case
      const caseResult = await this.findOrCreateModCase(entry, guild);

      if (caseResult.err) {
        return caseResult as Err<string>;
      }

      const processedLog = caseResult.val;
      if (!processedLog) {
        // Not a moderation-related event or mod log disabled
        return Ok.EMPTY;
      }

      // Step 2: Handle native timeout DMs if applicable
      let updatedModLogCase = processedLog.modLogCase;
      const dmResult = await this.sendTimeoutDMIfNeeded(
        processedLog.auditLogEvent,
        processedLog.targetUser,
        guild,
        processedLog.modLogCase.caseId,
        processedLog.wasPendingCase,
      );
      if (dmResult.err) {
        this.logger?.warn(
          { err: dmResult.val },
          "Failed to send native timeout DM, continuing with mod log posting",
        );
      } else if (dmResult.ok) {
        // Update the case object with DM information if DM was sent successfully
        const dmInfo = dmResult.val;
        if (dmInfo) {
          const dmResultForCase: DMResult = {};

          if (dmInfo.channelId) {
            dmResultForCase.channelId = dmInfo.channelId;
          }

          if (dmInfo.messageId) {
            dmResultForCase.messageId = dmInfo.messageId;
          }

          if (dmInfo.error) {
            dmResultForCase.error = dmInfo.error;
          }

          updatedModLogCase =
            processedLog.modLogCase.withDMResult(dmResultForCase);
        }
      }

      // Step 3: Post mod log message with updated case
      const postResult = await this.modLogPostingService.postModLogMessage(
        processedLog.auditLogEvent,
        updatedModLogCase,
        processedLog.targetUser,
        guild,
        processedLog.guildConfig.modLogChannelId,
      );

      if (postResult.err) {
        return postResult as Err<string>;
      }

      // Step 4: Update mod log case with message ID
      const messageId = postResult.val;
      await this.updateCaseMessageId(
        processedLog.modLogCase.guildId,
        processedLog.modLogCase.caseId,
        messageId,
      );

      return Ok.EMPTY;
    } catch (error) {
      this.logger?.error(
        {
          err: error,
          guildId: guild.id,
          entryAction: entry.action,
        },
        "Failed to handle audit log entry",
      );
      return Err(`Failed to handle audit log entry: ${error}`);
    }
  }

  /**
   * Converts Discord audit log entry to moderation case.
   * Finds existing pending case or creates a new one.
   * Checks guild configuration for mod log posting.
   */
  private async findOrCreateModCase(
    entry: GuildAuditLogsEntry,
    guild: Guild,
  ): Promise<Result<ProcessedAuditLog | null, string>> {
    try {
      // Convert Discord entry to domain entity
      const auditLogEvent = AuditLogEvent.fromDiscordEntry(guild.id, entry);
      if (!auditLogEvent) {
        // Unrelated audit log entry
        return Ok(null);
      }

      this.logger.debug(
        {
          guildId: guild.id,
          actionType: auditLogEvent.actionType,
          targetId: auditLogEvent.targetId,
          executorId: auditLogEvent.executorId,
        },
        "Processing moderation audit log event",
      );

      // Validate target
      if (!entry.targetId || entry.targetType !== "User") {
        this.logger.debug(
          { guildId: guild.id, targetType: entry.targetType },
          "Audit log target is not a user",
        );

        return Ok(null);
      }

      // Fetch target user
      const targetUser = await guild.client.users.fetch(entry.targetId);

      // Find or create mod log case (always do this to mark pending cases as complete)
      const { modLogCase, wasPendingCase } =
        await this.resolvePendingOrCreateCase(auditLogEvent, targetUser);

      // Check guild configuration for mod log posting
      const guildConfig = await this.guildConfigRepository.findByGuildId(
        guild.id,
      );
      if (
        !guildConfig.loggingSettings.modLogChannel ||
        !guildConfig.loggingSettings.modLogEnabled
      ) {
        this.logger.debug(
          {
            guildId: guild.id,
            modLogChannelId: guildConfig.loggingSettings.modLogChannel,
            modLogEnabled: guildConfig.loggingSettings.modLogEnabled,
            wasPendingCase,
            caseId: modLogCase.caseId,
          },
          "Case processed but mod log not configured or disabled",
        );

        // Case has been processed (marked as not pending), but no mod log posting
        return Ok(null);
      }

      return Ok({
        auditLogEvent,
        modLogCase,
        targetUser,
        guildConfig: {
          modLogChannelId: guildConfig.loggingSettings.modLogChannel,
        },
        wasPendingCase,
      });
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: guild.id,
          entryAction: entry.action,
        },
        "Failed to find or create mod case",
      );
      return Err(`Failed to find or create mod case: ${error}`);
    }
  }

  /**
   * Finds pending cases for the given audit log event.
   * Handles action type variations (Ban/TempBan, Timeout/TimeoutAdjust).
   */
  private async findPendingCases(
    auditLogEvent: AuditLogEvent,
  ): Promise<ModerationCase | null> {
    let actionTypesToSearch: ActionType[];

    if (auditLogEvent.actionType === ActionType.Ban) {
      // Ban audit log can be triggered by either ban or tempban actions
      actionTypesToSearch = [ActionType.Ban, ActionType.TempBan];
    } else if (auditLogEvent.actionType === ActionType.Timeout) {
      // Discord always sends Timeout events, but bot may have saved as TimeoutAdjust
      actionTypesToSearch = [ActionType.Timeout, ActionType.TimeoutAdjust];
    } else {
      actionTypesToSearch = [auditLogEvent.actionType];
    }

    const foundPendingCases: ModerationCase[] = [];
    for (const actionType of actionTypesToSearch) {
      // Look for pending case created in the last minute
      const pendingCase = await this.modLogRepository.findPendingCase(
        auditLogEvent.guildId,
        auditLogEvent.targetId,
        actionType,
        1, // maxAgeMinutes
      );

      if (pendingCase.err) {
        // Not if null, only if actual error
        throw new Error("Error finding pending case", {
          cause: pendingCase.val,
        });
      }

      // Not null, found result
      if (pendingCase.val) {
        foundPendingCases.push(pendingCase.val);
      }
    }

    // Select the most recent case if multiple found
    if (foundPendingCases.length === 0) {
      return null;
    }

    const foundPendingCase = foundPendingCases.reduce((mostRecent, current) =>
      current.actionTime > mostRecent.actionTime ? current : mostRecent,
    );

    // Log if we found a case with different action type than audit log
    if (foundPendingCase.actionType !== auditLogEvent.actionType) {
      this.logger.debug(
        {
          auditLogActionType: auditLogEvent.actionType,
          pendingCaseActionType: foundPendingCase.actionType,
          caseId: foundPendingCase.caseId,
          guildId: auditLogEvent.guildId,
        },
        "Found pending case with different action type than audit log",
      );
    }

    return foundPendingCase;
  }

  /**
   * Finds an existing pending mod log case or creates a new one.
   * Returns the moderation case and whether it was a pending case.
   */
  private async resolvePendingOrCreateCase(
    auditLogEvent: AuditLogEvent,
    targetUser: User,
  ): Promise<{ modLogCase: ModerationCase; wasPendingCase: boolean }> {
    const foundPendingCase = await this.findPendingCases(auditLogEvent);

    if (foundPendingCase) {
      this.logger.debug(
        {
          caseId: foundPendingCase.caseId,
          guildId: auditLogEvent.guildId,
          targetId: auditLogEvent.targetId,
          actionType: foundPendingCase.actionType,
          wasPending: foundPendingCase.pending,
        },
        "Found pending case, marking as not pending",
      );

      // Mark the case as not pending
      const updatedCaseResult = await this.modLogRepository.markAsNotPending(
        auditLogEvent.guildId,
        foundPendingCase.caseId,
      );
      if (updatedCaseResult.err) {
        this.logger.error(
          {
            err: updatedCaseResult.val,
            caseId: foundPendingCase.caseId,
            guildId: auditLogEvent.guildId,
          },
          "Failed to mark case as not pending",
        );
        throw new Error(
          `Failed to mark case as not pending: ${updatedCaseResult.val}`,
        );
      }

      this.logger.debug(
        {
          caseId: updatedCaseResult.val.caseId,
          guildId: updatedCaseResult.val.guildId,
          nowPending: updatedCaseResult.val.pending,
        },
        "Successfully marked case as not pending",
      );

      return {
        modLogCase: updatedCaseResult.val,
        wasPendingCase: true,
      };
    }

    this.logger.debug(
      {
        guildId: auditLogEvent.guildId,
        targetId: auditLogEvent.targetId,
        actionType: auditLogEvent.actionType,
      },
      "No pending case found, creating new case",
    );

    const newCase = await this.createNewCase(auditLogEvent, targetUser);

    return {
      modLogCase: newCase,
      wasPendingCase: false,
    };
  }

  private async createNewCase(
    auditLogEvent: AuditLogEvent,
    targetUser: User,
  ): Promise<ModerationCase> {
    // Create new case if no matching case found
    this.logger.debug("No pending case found, creating new case");

    // Extract timeout duration in seconds if available
    const timeoutDuration = auditLogEvent.timeoutChange?.asSeconds() ?? null;

    // For audit log cases, we need to generate a case ID using the existing pattern
    // Since we don't have access to ModerationCaseRepository here, we'll use the ModLogRepository
    // which handles the case ID generation internally
    const newCase = new ModerationCase(
      auditLogEvent.guildId,
      "placeholder", // Will be replaced by repository
      auditLogEvent.actionType,
      new Date(),
      auditLogEvent.targetId,
      targetUser.tag,
      auditLogEvent.executorId || null,
      auditLogEvent.reason
        ? Reason.create(auditLogEvent.reason).unwrap()
        : null,
      null, // Will be set when message is sent
      [], // No attachments for audit log cases
      null, // No DM result yet
      false, // Not pending since it's from audit log
      timeoutDuration,
    );

    const createResult = await this.modLogRepository.createCase(newCase);
    if (createResult.err) {
      throw new Error("Failed to create new mod log case", {
        cause: createResult.val,
      });
    }

    const createdCase = createResult.val;
    this.logger.debug(
      { caseId: createdCase.caseId },
      "Created new mod log case",
    );

    return createdCase;
  }

  /**
   * Handles native timeout DM sending if applicable.
   * Contains the business logic for when and how to send timeout DMs.
   * Returns the DM information if a DM was sent successfully.
   */
  private async sendTimeoutDMIfNeeded(
    auditLogEvent: AuditLogEvent,
    targetUser: User,
    guild: Guild,
    caseId: string,
    wasPendingCase: boolean,
  ): Promise<Result<DMSentResult | null, string>> {
    // Check if we should send a DM for this event
    let guildConfig: GuildConfig | undefined;
    try {
      guildConfig = await this.guildConfigRepository.findByGuildId(guild.id);
    } catch (error) {
      this.logger.warn(
        { err: error, guildId: guild.id },
        "Failed to fetch guild config for native timeout DM, using default",
      );
    }

    const shouldSend = auditLogEvent.shouldSendTimeoutDM(
      wasPendingCase,
      guildConfig,
    );

    if (!shouldSend) {
      return Ok(null);
    }

    // Send the DM
    const dmResult = await this.nativeTimeoutDMService.sendTimeoutDM(
      auditLogEvent,
      targetUser,
      guild,
      guildConfig,
    );

    if (dmResult.err) {
      return dmResult as Err<string>;
    }

    // Update mod log case with DM information
    const dmSentResult = dmResult.val;
    await this.updateCaseDMInfo(
      guild.id,
      caseId,
      dmSentResult.channelId,
      dmSentResult.messageId,
      dmSentResult.error,
    );

    return Ok(dmSentResult);
  }

  /**
   * Updates a mod log case with message ID.
   */
  private async updateCaseMessageId(
    guildId: string,
    caseId: string,
    messageId: string,
  ): Promise<Result<void, string>> {
    this.logger.debug(
      { guildId, caseId, messageId },
      "Updating mod log case with message ID",
    );

    const result = await this.modLogRepository.updateMessageId(
      guildId,
      caseId,
      messageId,
    );

    if (result.ok) {
      this.logger.debug(
        { guildId, caseId, messageId },
        "Successfully updated mod log case with message ID",
      );
    } else {
      this.logger.error(
        { guildId, caseId, messageId, err: result.val },
        "Failed to update mod log case with message ID",
      );
    }

    return result;
  }

  /**
   * Updates a mod log case with DM information.
   */
  private async updateCaseDMInfo(
    guildId: string,
    caseId: string,
    dmChannelId: string | null,
    dmMessageId: string | null,
    dmMessageError: string | null,
  ): Promise<Result<void, string>> {
    const dmResult = {
      channelId: dmChannelId || undefined,
      messageId: dmMessageId || undefined,
      error: dmMessageError || undefined,
    };

    const result = await this.modLogRepository.updateDMInfo(
      guildId,
      caseId,
      dmResult,
    );

    if (result.ok) {
      this.logger.debug(
        { guildId, caseId, dmChannelId, dmMessageId, dmMessageError },
        "Updated mod log case with DM information",
      );
    }

    return result;
  }
}

/**
 * Result of processing an audit log entry.
 */
export interface ProcessedAuditLog {
  auditLogEvent: AuditLogEvent;
  modLogCase: ModerationCase;
  targetUser: User;
  guildConfig: {
    modLogChannelId: string;
  };
  wasPendingCase: boolean;
}
