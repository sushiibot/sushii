import { Guild, User } from "discord.js";
import { Logger } from "pino";
import { Err, Ok, Result } from "ts-results";

import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import { DMNotificationService } from "../../shared/application/DMNotificationService";
import { Reason } from "../../shared/domain/value-objects/Reason";
import { AuditLogEvent } from "../domain/entities";

/**
 * Application service for sending DM notifications for native Discord timeouts.
 * Orchestrates the process of sending timeout DMs to users.
 */
export class NativeTimeoutDMService {
  constructor(
    private readonly dmNotificationService: DMNotificationService,
    private readonly logger: Logger,
  ) {}

  /**
   * Sends a timeout DM to the target user.
   */
  async sendTimeoutDM(
    auditLogEvent: AuditLogEvent,
    targetUser: User,
    guild: Guild,
    guildConfig?: GuildConfig,
  ): Promise<Result<DMSentResult, string>> {
    try {
      if (!auditLogEvent.timeoutChange) {
        return Err("No timeout change data available");
      }

      this.logger.info(
        {
          actionType: auditLogEvent.actionType,
          timeoutChange: auditLogEvent.timeoutChange,
          targetUserId: targetUser.id,
          guildId: guild.id,
        },
        "Sending timeout DM to user",
      );

      // Convert string reason to domain value object
      let reason: Reason | null = null;
      if (auditLogEvent.reason) {
        const reasonResult = Reason.create(auditLogEvent.reason);
        if (reasonResult.ok) {
          reason = reasonResult.val;
        }
      }

      // Use the DM notification service
      const dmResult = await this.dmNotificationService.sendModerationDM(
        targetUser,
        guild,
        auditLogEvent.actionType,
        true, // should dm reason
        reason,
        auditLogEvent.timeoutChange.newTimestamp || null,
        guildConfig,
      );

      if (!dmResult.ok) {
        return Err(dmResult.val);
      }

      const dmSentResult = dmResult.val;

      this.logger.debug(
        {
          targetUserId: targetUser.id,
          guildId: guild.id,
          dmChannelId: dmSentResult.channelId,
          dmMessageId: dmSentResult.messageId,
        },
        "Successfully sent timeout DM",
      );

      return Ok(dmSentResult);
    } catch (error) {
      this.logger.debug(
        {
          err: error,
          actionType: auditLogEvent.actionType,
          timeoutChange: auditLogEvent.timeoutChange,
          targetUserId: targetUser.id,
          guildId: guild.id,
        },
        "Failed to send timeout DM to user",
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return Ok({
        channelId: null,
        messageId: null,
        error: errorMessage,
      });
    }
  }
}

/**
 * Result of attempting to send a DM.
 */
export interface DMSentResult {
  channelId: string | null;
  messageId: string | null;
  error: string | null;
}
