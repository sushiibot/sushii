import type {
  ChatInputCommandInteraction} from "discord.js";
import {
  EmbedBuilder,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";
import Color from "@/utils/colors";

import type { TagAdminService } from "../../application/TagAdminService";

enum TagAdminSubcommand {
  Delete = "delete",
  DeleteUserTags = "delete_user_tags",
}

export class TagAdminCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("tag-admin")
    .setDescription("Modify server tags.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((c) =>
      c
        .setName(TagAdminSubcommand.Delete)
        .setDescription("Delete a tag.")
        .addStringOption((o) =>
          o
            .setName("name")
            .setDescription("The tag name to delete.")
            .setAutocomplete(true)
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName(TagAdminSubcommand.DeleteUserTags)
        .setDescription("Delete all tags created by a specific user.")
        .addUserOption((o) =>
          o
            .setName("user")
            .setDescription("The user to delete ALL tags.")
            .setRequired(true),
        ),
    )
    .toJSON();

  constructor(
    private readonly tagAdminService: TagAdminService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not in cached guild");
    }

    switch (interaction.options.getSubcommand()) {
      case TagAdminSubcommand.Delete:
        return this.deleteHandler(interaction);

      case TagAdminSubcommand.DeleteUserTags:
        return this.deleteUserTagsHandler(interaction);
      default:
        throw new Error("Unknown subcommand.");
    }
  }

  private async deleteHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const tagName = interaction.options.getString("name", true);

    const result = await this.tagAdminService.adminDeleteTag({
      name: tagName,
      guildId: interaction.guildId,
    });

    if (result.err) {
      const embed = new EmbedBuilder()
        .setTitle("Tag Admin")
        .setDescription(result.val)
        .setColor(Color.Error);

      await interaction.reply({
        embeds: [embed],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Tag Admin")
      .setDescription(`Tag \`${tagName}\` deleted`)
      .setColor(Color.Info);

    await interaction.reply({
      embeds: [embed],
    });
  }

  private async deleteUserTagsHandler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const user = interaction.options.getUser("user", true);

    const deleteCount = await this.tagAdminService.adminDeleteUserTags({
      guildId: interaction.guildId,
      ownerId: user.id,
    });

    if (deleteCount === 0) {
      const embed = new EmbedBuilder()
        .setTitle("No tags deleted")
        .setDescription(`${user} had no tags.`)
        .setColor(Color.Error);

      await interaction.reply({
        embeds: [embed],
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Tags deleted")
      .setDescription(`${deleteCount} tags created by ${user} deleted`)
      .setColor(Color.Info);

    await interaction.reply({
      embeds: [embed],
    });
  }
}
