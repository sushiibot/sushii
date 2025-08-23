import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ReactionBatch } from "../domain/types/ReactionEvent";
import { createReactionLogMessage } from "../presentation/views/ReactionLogMessageBuilder";

export class ReactionLogService {
  constructor(
    private readonly client: Client,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger
  ) {}
  
  /**
   * Log a completed reaction batch to Discord
   */
  async logBatch(batch: ReactionBatch): Promise<void> {
    try {
      // Get guild configuration
      const config = await this.guildConfigRepository.findByGuildId(batch.guildId);
      
      // Check if reaction logging is enabled and channel is configured
      if (!config.loggingSettings.reactionLogEnabled) {
        this.logger.debug(
          { guildId: batch.guildId },
          "Reaction logging disabled for guild"
        );
        return;
      }
      
      if (!config.loggingSettings.reactionLogChannel) {
        this.logger.debug(
          { guildId: batch.guildId },
          "No reaction log channel configured for guild"
        );
        return;
      }
      
      // Get the log channel
      const channel = this.client.channels.cache.get(
        config.loggingSettings.reactionLogChannel
      );
      
      if (!channel?.isSendable()) {
        this.logger.warn(
          {
            guildId: batch.guildId,
            channelId: config.loggingSettings.reactionLogChannel,
          },
          "Reaction log channel not found or not sendable"
        );
        return;
      }
      
      // Create and send the log message
      const message = createReactionLogMessage(batch);
      
      await channel.send(message);
      
      this.logger.debug(
        {
          guildId: batch.guildId,
          messageId: batch.messageId,
          channelId: config.loggingSettings.reactionLogChannel,
          actionCount: batch.actions.length,
        },
        "Sent reaction log"
      );
      
    } catch (err) {
      this.logger.error(
        { err, batch },
        "Failed to send reaction log"
      );
    }
  }
}