import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { GuildReactionBatch } from "../domain/types/ReactionEvent";
import { createGuildReactionLogMessage } from "../presentation/views/ReactionLogMessageBuilder";

export class ReactionLogService {
  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  /**
   * Log a completed guild reaction batch to Discord
   */
  async logGuildBatch(
    guildBatch: GuildReactionBatch,
    reactionLogChannelId: string,
  ): Promise<void> {
    try {
      // Get the log channel
      const channel = await this.client.channels.fetch(reactionLogChannelId);

      if (!channel?.isSendable()) {
        this.logger.warn(
          {
            guildId: guildBatch.guildId,
            channelId: reactionLogChannelId,
          },
          "Reaction log channel not found or not sendable",
        );
        return;
      }

      // Validate that channel is not a thread (threads are not supported)
      if (channel.isThread()) {
        this.logger.warn(
          {
            guildId: guildBatch.guildId,
            channelId: reactionLogChannelId,
          },
          "Reaction log channel is a thread - threads are not supported",
        );
        return;
      }

      // Create and send the guild log message
      const message = createGuildReactionLogMessage(guildBatch);
      await channel.send(message);

      const totalRemovals = Array.from(guildBatch.removals.values()).reduce(
        (sum, events) => sum + events.length,
        0,
      );

      this.logger.trace(
        {
          guildId: guildBatch.guildId,
          channelId: reactionLogChannelId,
          messagesCount: guildBatch.removals.size,
          totalRemovals,
        },
        "Successfully sent guild reaction log message",
      );
    } catch (err) {
      this.logger.error(
        {
          err,
          guildId: guildBatch.guildId,
          channelId: reactionLogChannelId,
        },
        "Failed to send guild reaction log message",
      );
    }
  }
}
