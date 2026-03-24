import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { TagService } from "../../application/TagService";
import { TAG_STATUS_EMOJIS, createTagNotFoundContainer } from "../views/TagMessageBuilder";

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
      throw new Error("Missing tag name");
    }

    const [result, emojis] = await Promise.all([
      this.tagService.useTag(tagName, interaction.guildId),
      this.emojiRepository.getEmojis(TAG_STATUS_EMOJIS),
    ]);

    if (result.err) {
      await interaction.reply({
        components: [createTagNotFoundContainer(tagName, emojis["fail"])],
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
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
