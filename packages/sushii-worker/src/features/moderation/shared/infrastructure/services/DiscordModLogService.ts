import type { Client } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import buildModLogEmbed from "@/features/moderation/shared/presentation/buildModLogEmbed";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ModerationCase } from "../../domain/entities/ModerationCase";
import type { ModerationTarget } from "../../domain/entities/ModerationTarget";
import { ModLogComponentBuilder } from "../../domain/services/ModLogComponentBuilder";
import type { ModLogService } from "../../domain/services/ModLogService";
import { ActionType } from "../../domain/value-objects/ActionType";

/**
 * Discord.js implementation of mod log service.
 * Posts moderation actions to guild's configured mod log channels.
 */
export class DiscordModLogService implements ModLogService {
  constructor(
    private readonly client: Client,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  async sendModLog(
    guildId: string,
    actionType: ActionType,
    target: ModerationTarget,
    moderationCase: ModerationCase,
  ): Promise<Result<void, string>> {
    try {
      // Check if this action type should be posted
      if (!this.shouldPostToModLog(actionType)) {
        return Ok.EMPTY;
      }

      // Get guild configuration for mod log channel
      const guildConfig =
        await this.guildConfigRepository.findByGuildId(guildId);

      if (
        !guildConfig.loggingSettings.modLogEnabled ||
        !guildConfig.loggingSettings.modLogChannel
      ) {
        this.logger.debug(
          { guildId, actionType },
          "Mod log not enabled or channel not configured",
        );
        return Ok.EMPTY;
      }

      // Build the mod log embed and components
      const embed = await buildModLogEmbed(
        this.client,
        actionType,
        target.user,
        {
          case_id: moderationCase.caseId,
          executor_id: moderationCase.executorId,
          reason: moderationCase.reason?.value || null,
          attachments: moderationCase.attachments || [],
        },
      );

      // Build message components
      const componentBuilder = new ModLogComponentBuilder(
        actionType,
        moderationCase,
      );
      const components = componentBuilder.build();

      // Fetch and send to mod log channel
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) {
        return Err("Guild not found");
      }

      const modLogChannel = await guild.channels.fetch(
        guildConfig.loggingSettings.modLogChannel,
      );
      if (!modLogChannel || !modLogChannel.isTextBased()) {
        return Err("Mod log channel not found or not text-based");
      }

      await modLogChannel.send({
        embeds: [embed],
        components,
      });

      this.logger.info(
        {
          guildId,
          actionType,
          targetId: target.id,
          caseId: moderationCase.caseId,
          channelId: modLogChannel.id,
        },
        "Posted moderation action to mod log channel",
      );

      return Ok.EMPTY;
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId,
          actionType,
          targetId: target.id,
          caseId: moderationCase.caseId,
        },
        "Failed to send mod log",
      );
      return Err(`Failed to send mod log: ${error}`);
    }
  }

  shouldPostToModLog(actionType: ActionType): boolean {
    // Based on legacy logic - only Warn and Note actions are manually posted
    // Other actions are handled by Discord event listeners
    return actionType === ActionType.Warn || actionType === ActionType.Note;
  }
}
