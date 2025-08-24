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

import type { ReactionStarterRepository } from "../../domain/repositories/ReactionStarterRepository";
import {
  type ReactionStartersViewData,
  createReactionStartersMessage,
} from "../views/ReactionStartersView";

type ReactionMetadata = {
  emojiId?: string;
  emojiName?: string;
};

type CurrentReactionWithStarter = {
  emoji: string;
  starterId: string;
  emojiId?: string;
  emojiName?: string;
};

type CurrentReactionWithoutStarter = {
  emoji: string;
  emojiId?: string;
  emojiName?: string;
};

type RemovedReaction = {
  emoji: string;
  starterId: string;
};

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

      // Get current reactions on the message
      const currentReactions = new Map<string, ReactionMetadata>();

      for (const [emojiString, reaction] of message.reactions.cache) {
        currentReactions.set(emojiString, {
          emojiId: reaction.emoji.id || undefined,
          emojiName: reaction.emoji.name || undefined,
        });
      }

      // Categorize reactions
      const currentWithStarters: CurrentReactionWithStarter[] = [];
      const currentWithoutStarters: CurrentReactionWithoutStarter[] = [];
      const completelyRemoved: RemovedReaction[] = [];

      // Process current reactions
      for (const [emoji, reactionData] of currentReactions) {
        const starterId = allStarters.get(emoji);
        if (starterId) {
          currentWithStarters.push({
            emoji,
            starterId,
            emojiId: reactionData.emojiId,
            emojiName: reactionData.emojiName,
          });
        } else {
          currentWithoutStarters.push({
            emoji,
            emojiId: reactionData.emojiId,
            emojiName: reactionData.emojiName,
          });
        }
      }

      // Process completely removed reactions
      for (const [emoji, starterId] of allStarters) {
        if (!currentReactions.has(emoji)) {
          completelyRemoved.push({ emoji, starterId });
        }
      }

      // Build view data
      const viewData: ReactionStartersViewData = {
        currentWithStarters,
        currentWithoutStarters,
        completelyRemoved,
        allStarters,
      };

      // Create and send response using components v2
      const replyOptions = createReactionStartersMessage(viewData);
      await interaction.reply({
        ...replyOptions,
        ephemeral: true,
      });

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
