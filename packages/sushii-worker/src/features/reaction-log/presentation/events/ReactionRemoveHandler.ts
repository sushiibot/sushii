import type {
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { ReactionBatchProcessor } from "../../application/ReactionBatchProcessor";
import type { ReactionEvent } from "../../domain/types/ReactionEvent";

export class ReactionRemoveHandler extends EventHandler<Events.MessageReactionRemove> {
  readonly eventType = Events.MessageReactionRemove;

  constructor(
    private readonly batchProcessor: ReactionBatchProcessor,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    try {
      // Ignore DMs (guildId will be null)
      if (!reaction.message.guildId) {
        return;
      }

      // Ignore bot reactions
      if (user.bot) {
        return;
      }

      const event: ReactionEvent = {
        messageId: reaction.message.id,
        channelId: reaction.message.channelId,
        guildId: reaction.message.guildId,
        userId: user.id,
        emoji: reaction.emoji.toString(),
        emojiName: reaction.emoji.name || undefined,
        emojiId: reaction.emoji.id || undefined,
        type: "remove",
        timestamp: new Date(),
        // Will be set by processor based on database lookup
        isInitial: false,
      };

      await this.batchProcessor.queueReactionEvent(event);
    } catch (err) {
      this.logger.error(
        {
          err,
          messageId: reaction.message.id,
          userId: user.id,
          emoji: reaction.emoji.toString(),
        },
        "Failed to handle reaction remove event",
      );
    }
  }
}
