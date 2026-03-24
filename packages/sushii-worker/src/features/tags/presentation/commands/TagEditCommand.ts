import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { TagService } from "../../application/TagService";
import {
  TAG_STATUS_EMOJIS,
  createTagErrorContainer,
  createTagNotFoundContainer,
} from "../views/TagMessageBuilder";
import type { TagEditInteractionHandler } from "./TagEditInteractionHandler";

export class TagEditCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("tag-edit")
    .setDescription("Edit a tag's content, rename it, or delete it.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("The tag name to edit.")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .toJSON();

  constructor(
    private readonly tagService: TagService,
    private readonly editInteractionHandler: TagEditInteractionHandler,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("This command can only be used in a guild.");
    }

    const tagName = interaction.options.getString("name");
    if (!tagName) {
      throw new Error("Missing tag name.");
    }

    const [tag, emojis] = await Promise.all([
      this.tagService.getTag(tagName, interaction.guildId),
      this.emojiRepository.getEmojis(TAG_STATUS_EMOJIS),
    ]);

    if (!tag) {
      await interaction.reply({
        components: [createTagNotFoundContainer(tagName, emojis["fail"])],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const hasManageGuildPermission = interaction.member.permissions.has(
      PermissionFlagsBits.ManageGuild,
    );

    if (!tag.canBeModifiedBy(interaction.user.id, hasManageGuildPermission)) {
      await interaction.reply({
        components: [
          createTagErrorContainer(
            "Permission Denied",
            "You don't have permission to edit this tag, you can only edit your own tags.",
            emojis["fail"],
          ),
        ],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    // Delegate to the edit interaction handler
    await this.editInteractionHandler.handleEditInterface(interaction, tag);
  }
}
