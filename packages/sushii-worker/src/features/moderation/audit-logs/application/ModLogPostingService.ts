import type { Guild, User } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ModLogComponentBuilder } from "@/features/moderation/shared/domain/services/ModLogComponentBuilder";
import buildModLogEmbed from "@/features/moderation/shared/presentation/buildModLogEmbed";

import type { AuditLogEvent } from "../domain/entities";

/**
 * Application service for posting mod log messages to Discord channels.
 * Handles the orchestration of embed creation and message posting.
 */
export class ModLogPostingService {
  constructor(private readonly logger: Logger) {}

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
      // Build the mod log embed
      const embed = await buildModLogEmbed(
        guild.client,
        auditLogEvent.actionType,
        targetUser,
        {
          case_id: modLogCase.caseId,
          executor_id: auditLogEvent.executorId || null,
          reason: modLogCase.reason?.value || null,
          attachments: modLogCase.attachments,
        },
        auditLogEvent.timeoutChange,
      );

      // Build message components
      const modLogComponents = new ModLogComponentBuilder(
        auditLogEvent.actionType,
        modLogCase,
      );
      const components = modLogComponents.build();

      // Fetch and validate mod log channel
      const channel = await guild.channels.fetch(modLogChannelId);
      if (!channel?.isTextBased()) {
        return Err("Mod log channel not found or not text-based");
      }

      // Send the mod log message
      const sentMessage = await channel.send({
        embeds: [embed.toJSON()],
        components,
      });

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
      this.logger.error(
        {
          err: error,
          guildId: guild.id,
          actionType: auditLogEvent.actionType,
          targetId: auditLogEvent.targetId,
          caseId: modLogCase.caseId,
          modLogChannelId,
        },
        "Failed to post mod log message",
      );

      return Err(`Failed to post mod log message: ${error}`);
    }
  }
}
