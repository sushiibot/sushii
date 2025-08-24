import type {
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { ReactionStarterService } from "../../application/ReactionStarterService";

export class ReactionAddHandler extends EventHandler<Events.MessageReactionAdd> {
  readonly eventType = Events.MessageReactionAdd;

  constructor(
    private readonly reactionStarterService: ReactionStarterService,
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

      // Always track reaction starters (regardless of logging configuration)
      // This is needed for the context menu command to work
      const { isNew } = await this.reactionStarterService.getOrSetStarter(
        reaction.message.id,
        reaction.emoji.toString(),
        user.id,
        reaction.message.guildId,
      );

      if (isNew) {
        this.logger.trace(
          {
            messageId: reaction.message.id,
            emoji: reaction.emoji.toString(),
            userId: user.id,
            guildId: reaction.message.guildId,
          },
          "Tracked new reaction starter",
        );
      }

      // NOTE: We no longer do any batch processing for additions
      // Only removals are logged to reduce spam and rate limiting
    } catch (err) {
      this.logger.error(
        {
          err,
          messageId: reaction.message.id,
          userId: user.id,
          emoji: reaction.emoji.toString(),
        },
        "Failed to handle reaction add event",
      );
    }
  }
}
