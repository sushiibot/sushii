import type { Client, NewsChannel, TextChannel } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import type { Logger } from "pino";

import type { ReactionBatch } from "../domain/types/ReactionEvent";
import { createReactionLogMessage } from "../presentation/views/ReactionLogMessageBuilder";

export class ReactionLogService {
  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  /**
   * Log a completed reaction batch to Discord
   */
  async logBatch(
    batch: ReactionBatch,
    reactionLogChannelId: string,
  ): Promise<void> {
    try {
      // Get the log channel
      const channel = this.client.channels.cache.get(reactionLogChannelId);

      if (!channel?.isSendable()) {
        this.logger.warn(
          {
            guildId: batch.guildId,
            channelId: reactionLogChannelId,
          },
          "Reaction log channel not found or not sendable",
        );
        return;
      }

      // Validate bot permissions in the channel
      if (channel.isThread()) {
        this.logger.warn(
          {
            guildId: batch.guildId,
            channelId: reactionLogChannelId,
          },
          "Reaction log channel is a thread - threads are not supported",
        );
        return;
      }

      const textChannel = channel as TextChannel | NewsChannel;
      const botMember = textChannel.guild.members.me;

      if (!botMember) {
        this.logger.warn(
          {
            guildId: batch.guildId,
            channelId: reactionLogChannelId,
          },
          "Bot member not found in guild",
        );
        return;
      }

      const permissions = textChannel.permissionsFor(botMember);
      const requiredPermissions = [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ViewChannel,
      ];

      const missingPermissions = requiredPermissions.filter(
        (permission) => !permissions?.has(permission),
      );

      if (missingPermissions.length > 0) {
        this.logger.warn(
          {
            guildId: batch.guildId,
            channelId: reactionLogChannelId,
            missingPermissions: missingPermissions.map((p) => p.toString()),
          },
          "Bot missing required permissions for reaction log channel",
        );
        return;
      }

      // Create and send the log message
      const message = createReactionLogMessage(batch);

      try {
        await textChannel.send(message);

        this.logger.trace(
          {
            guildId: batch.guildId,
            channelId: reactionLogChannelId,
            actionCount: batch.actions.length,
          },
          "Successfully sent reaction log message",
        );
      } catch (err) {
        this.logger.error(
          {
            err,
            guildId: batch.guildId,
            channelId: reactionLogChannelId,
          },
          "Failed to send reaction log message",
        );
        throw err;
      }
    } catch (err) {
      this.logger.error({ err, batch }, "Failed to send reaction log");
    }
  }
}
