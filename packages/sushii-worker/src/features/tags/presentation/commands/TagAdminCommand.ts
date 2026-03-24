import type { ChatInputCommandInteraction } from "discord.js";
import {
  ContainerBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type { TagAdminService } from "../../application/TagAdminService";
import {
  TAG_STATUS_EMOJIS,
  type TagStatusEmojiMap,
  createTagErrorContainer,
} from "../views/TagMessageBuilder";

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
    private readonly emojiRepository: BotEmojiRepository,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const emojis = await this.emojiRepository.getEmojis(TAG_STATUS_EMOJIS);

    switch (interaction.options.getSubcommand()) {
      case TagAdminSubcommand.Delete:
        return this.deleteHandler(interaction, emojis);

      case TagAdminSubcommand.DeleteUserTags:
        return this.deleteUserTagsHandler(interaction, emojis);
      default:
        throw new Error("Unknown subcommand.");
    }
  }

  private async deleteHandler(
    interaction: ChatInputCommandInteraction<"cached">,
    emojis: TagStatusEmojiMap,
  ): Promise<void> {
    const tagName = interaction.options.getString("name", true);

    const result = await this.tagAdminService.adminDeleteTag({
      name: tagName,
      guildId: interaction.guildId,
    });

    if (result.err) {
      await interaction.reply({
        components: [
          createTagErrorContainer("Delete failed", result.val, emojis["fail"]),
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const container = new ContainerBuilder().setAccentColor(Color.Success);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${emojis["success"]} **Tag deleted**\nTag \`${tagName}\` has been deleted.`,
      ),
    );
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }

  private async deleteUserTagsHandler(
    interaction: ChatInputCommandInteraction<"cached">,
    emojis: TagStatusEmojiMap,
  ): Promise<void> {
    const user = interaction.options.getUser("user", true);

    const deleteCount = await this.tagAdminService.adminDeleteUserTags({
      guildId: interaction.guildId,
      ownerId: user.id,
    });

    if (deleteCount === 0) {
      await interaction.reply({
        components: [
          createTagErrorContainer("No tags deleted", `${user} had no tags.`, emojis["fail"]),
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const container = new ContainerBuilder().setAccentColor(Color.Success);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${emojis["success"]} **Tags deleted**\n${deleteCount} tags created by ${user} deleted.`,
      ),
    );
    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }
}
