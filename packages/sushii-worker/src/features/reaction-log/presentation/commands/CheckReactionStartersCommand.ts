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
      const currentReactions = new Map<string, boolean>(); // emoji -> starterStillReacted
      for (const [emojiString, reaction] of message.reactions.cache) {
        const starterId = allStarters.get(emojiString);
        const starterStillReacted = starterId
          ? reaction.users.cache.has(starterId)
          : false;
        currentReactions.set(emojiString, starterStillReacted);
      }

      // Categorize reactions
      const currentWithStarters: {
        emoji: string;
        starterId: string;
        starterRemoved: boolean;
      }[] = [];
      const currentWithoutStarters: string[] = [];
      const completelyRemoved: { emoji: string; starterId: string }[] = [];

      // Process current reactions
      for (const [emoji] of currentReactions) {
        const starterId = allStarters.get(emoji);
        if (starterId) {
          const starterRemoved = !currentReactions.get(emoji);
          currentWithStarters.push({ emoji, starterId, starterRemoved });
        } else {
          currentWithoutStarters.push(emoji);
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
