import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import type { TagService } from "../../application/TagService";
import { createTagNotFoundEmbed } from "../views/TagMessageBuilder";

export class TagGetCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("t")
    .setDescription("Use a tag.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("The tag name.")
        .setRequired(true)
        .setAutocomplete(true),
    )
    .toJSON();

  constructor(
    private readonly tagService: TagService,
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
      throw new Error("Missing tag name");
    }

    const result = await this.tagService.useTag(tagName, interaction.guildId);

    if (result.err) {
      await interaction.reply({
        embeds: [createTagNotFoundEmbed(tagName)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const tag = result.val;
    await interaction.reply({
      content: tag.getDisplayContent(),
      allowedMentions: {
        parse: [],
      },
    });
  }
}
