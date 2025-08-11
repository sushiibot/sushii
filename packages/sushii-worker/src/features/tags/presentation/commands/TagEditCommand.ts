import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import type { TagService } from "../../application/TagService";
import {
  createTagErrorEmbed,
  createTagNotFoundEmbed,
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

    const tag = await this.tagService.getTag(tagName, interaction.guildId);
    const embed = createTagNotFoundEmbed(tagName);

    if (!tag) {
      await interaction.reply({
        embeds: [embed],
      });
      return;
    }

    const hasManageGuildPermission = interaction.member.permissions.has(
      PermissionFlagsBits.ManageGuild,
    );

    if (!tag.canBeModifiedBy(interaction.user.id, hasManageGuildPermission)) {
      const embed = createTagErrorEmbed(
        "Permission Denied",
        "You don't have permission to edit this tag, you can only edit your own tags.",
      );

      await interaction.reply({
        embeds: [embed],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Delegate to the edit interaction handler
    await this.editInteractionHandler.handleEditInterface(interaction, tag);
  }
}
