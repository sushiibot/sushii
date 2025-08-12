import type { Guild, GuildAuditLogsEntry, User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { DMResult } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { AuditLogEvent } from "../domain/entities";
import type { AuditLogProcessingService } from "./AuditLogProcessingService";
import type { ModLogPostingService } from "./ModLogPostingService";
import type {
  DMSentResult,
  NativeTimeoutDMService,
} from "./NativeTimeoutDMService";

/**
 * Application service that orchestrates the complete audit log processing workflow.
 * Contains all business logic for handling audit log events end-to-end.
 */
export class AuditLogOrchestrationService {
  constructor(
    private readonly auditLogProcessingService: AuditLogProcessingService,
    private readonly nativeTimeoutDMService: NativeTimeoutDMService,
    private readonly modLogPostingService: ModLogPostingService,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Handles the complete audit log processing workflow.
   */
  async handleAuditLogEntry(
    entry: GuildAuditLogsEntry,
    guild: Guild,
  ): Promise<Result<void, string>> {
    try {
      // Step 1: Process the audit log entry
      const processResult =
        await this.auditLogProcessingService.processAuditLogEntry(entry, guild);

      if (processResult.err) {
        return processResult as Err<string>;
      }

      const processedLog = processResult.val;
      if (!processedLog) {
        // Not a moderation-related event or mod log disabled
        return Ok.EMPTY;
      }

      // Step 2: Handle native timeout DMs if applicable
      let updatedModLogCase = processedLog.modLogCase;
      const dmResult = await this.handleNativeTimeoutDM(
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
      await this.auditLogProcessingService.updateModLogCaseMessageId(
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
   * Handles native timeout DM sending if applicable.
   * Contains the business logic for when and how to send timeout DMs.
   * Returns the DM information if a DM was sent successfully.
   */
  private async handleNativeTimeoutDM(
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
    await this.auditLogProcessingService.updateModLogCaseDMInfo(
      caseId,
      dmSentResult.channelId,
      dmSentResult.messageId,
      dmSentResult.error,
    );

    return Ok(dmSentResult);
  }
}
