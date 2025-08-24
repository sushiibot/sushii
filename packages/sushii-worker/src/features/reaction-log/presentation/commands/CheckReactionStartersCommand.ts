import {
  type ContextMenuCommandInteraction,
  InteractionContextType,
} from "discord.js";
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import type { Logger } from "pino";

import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import type { ReactionStarter } from "../../domain/entities/ReactionStarter";
import type { ReactionStarterRepository } from "../../domain/repositories/ReactionStarterRepository";
import {
  type ReactionStartersViewData,
  createReactionStartersMessage,
} from "../views/ReactionStartersView";

interface ReactionMetadata {
  emojiId?: string;
  emojiName?: string;
}

interface CurrentReactionWithStarter {
  emoji: string;
  starterIds: string[];
  emojiId?: string;
  emojiName?: string;
}

interface CurrentReactionWithoutStarter {
  emoji: string;
  emojiId?: string;
  emojiName?: string;
}

export class CheckReactionStartersCommand extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("View Reaction Starters")
    .setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  constructor(
    private readonly reactionStarterRepository: ReactionStarterRepository,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ContextMenuCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Command not used in cached guild");
    }

    if (!interaction.isMessageContextMenuCommand()) {
      throw new Error("Command used on non-message");
    }

    try {
      const message = interaction.targetMessage;

      // Get ALL reaction starters from database (includes removed reactions)
      const allStarters =
        await this.reactionStarterRepository.getAllStartersForMessage(
          message.id,
        );

      this.logger.debug(
        {
          messageReactionsCache: message.reactions.cache,
        },
        "Message reactions cache",
      );

      // Get current reactions on the message
      const currentReactions = new Map<string, ReactionMetadata>();

      for (const reaction of message.reactions.cache.values()) {
        // Use emoji ID for custom emojis, unicode string for standard emojis
        const emojiKey = reaction.emoji.id || reaction.emoji.toString();
        currentReactions.set(emojiKey, {
          emojiId: reaction.emoji.id || undefined,
          emojiName: reaction.emoji.name || undefined,
        });
      }

      // Categorize reactions
      const currentWithStarters: CurrentReactionWithStarter[] = [];
      const currentWithoutStarters: CurrentReactionWithoutStarter[] = [];
      const completelyRemoved: ReactionStarter[] = [];

      // Process current reactions
      for (const [emojiId, reactionData] of currentReactions) {
        const starter = allStarters.get(emojiId);

        // Check if there are any starter IDs for this emoji
        if (starter && starter.getStarterCount() > 0) {
          // Use display string from current reaction data (more accurate)
          const displayString =
            reactionData.emojiId && reactionData.emojiName
              ? `<:${reactionData.emojiName}:${reactionData.emojiId}>`
              : emojiId; // For native emojis, emojiId IS the display string

          currentWithStarters.push({
            emoji: displayString,
            starterIds: starter.userIds,
            emojiId: reactionData.emojiId,
            emojiName: reactionData.emojiName,
          });
          continue;
        }

        // No starter IDs found
        const displayString =
          reactionData.emojiId && reactionData.emojiName
            ? `<:${reactionData.emojiName}:${reactionData.emojiId}>`
            : emojiId; // For native emojis, emojiId IS the display string

        currentWithoutStarters.push({
          emoji: displayString,
          emojiId: reactionData.emojiId,
          emojiName: reactionData.emojiName,
        });
      }

      // Process completely removed reactions
      for (const [emojiId, starter] of allStarters) {
        if (!currentReactions.has(emojiId)) {
          // Push the starter entity directly
          completelyRemoved.push(starter);
        }
      }

      // Build view data
      const viewData: ReactionStartersViewData = {
        currentWithStarters,
        currentWithoutStarters,
        completelyRemoved,
        allStarters,
      };

      const replyOptions = createReactionStartersMessage(viewData);
      await interaction.reply(replyOptions);

      this.logger.trace(
        {
          guildId: interaction.guildId,
          messageId: message.id,
          userId: interaction.user.id,
          totalStarters: allStarters.size,
          currentReactions: currentReactions.size,
          completelyRemoved: completelyRemoved.length,
        },
        "Checked reaction starters with complete history",
      );
    } catch (err) {
      this.logger.error(
        {
          err,
          guildId: interaction.guildId,
          messageId: interaction.targetMessage?.id,
          userId: interaction.user.id,
        },
        "Failed to check reaction starters",
      );

      await interaction.reply({
        content: "Failed to check reaction starters.",
        ephemeral: true,
      });
    }
  }
}
