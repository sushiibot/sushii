import {
  DiscordAPIError,
  type Guild,
  RESTJSONErrorCodes,
  type User,
} from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ModLogMessageService } from "@/features/moderation/shared/application/ModLogMessageService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";

import type { AuditLogEvent } from "../domain/entities";

/**
 * Application service for posting mod log messages to Discord channels.
 * Renders the case and posts it to the mod log channel.
 */
export class ModLogPostingService {
  constructor(
    private readonly modLogMessageService: ModLogMessageService,
    private readonly logger: Logger,
  ) {}

  /**
   * Posts a mod log message to the configured guild channel.
   */
  async postModLogMessage(
    auditLogEvent: AuditLogEvent,
    modLogCase: ModerationCase,
    targetUser: User,
    guild: Guild,
    modLogChannelId: string,
  ): Promise<Result<string, string>> {
    try {
      // modLogCase.actionType (e.g. TempBan), not the audit log's, which
      // Discord always reports as Ban for bans
      const message = await this.modLogMessageService.render(modLogCase, {
        targetUser,
        timeoutChange: auditLogEvent.timeoutChange,
      });

      // Fetch and validate mod log channel
      const channel = await guild.channels.fetch(modLogChannelId);
      if (!channel?.isTextBased()) {
        return Err("Mod log channel not found or not text-based");
      }

      // Send the mod log message
      const sentMessage = await channel.send(message);

      this.logger.info(
        {
          guildId: guild.id,
          actionType: auditLogEvent.actionType,
          targetId: auditLogEvent.targetId,
          caseId: modLogCase.caseId,
          channelId: channel.id,
          messageId: sentMessage.id,
        },
        "Posted mod log message",
      );

      return Ok(sentMessage.id);
    } catch (error) {
      const isPermissionError =
        error instanceof DiscordAPIError &&
        (Number(error.code) === RESTJSONErrorCodes.MissingPermissions ||
          Number(error.code) === RESTJSONErrorCodes.MissingAccess);

      // Missing permissions is an expected guild misconfiguration; anything
      // else is unexpected and propagates to the caller.
      if (!isPermissionError) {
        throw error;
      }

      this.logger.warn(
        {
          err: error,
          guildId: guild.id,
          actionType: auditLogEvent.actionType,
          targetId: auditLogEvent.targetId,
          caseId: modLogCase.caseId,
          modLogChannelId,
        },
        "Failed to post mod log message: missing permissions",
      );

      return Err("Missing permissions to post in mod log channel");
    }
  }
}
