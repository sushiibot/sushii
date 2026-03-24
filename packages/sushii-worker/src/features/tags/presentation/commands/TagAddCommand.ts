import type { ChatInputCommandInteraction } from "discord.js";
import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { t } from "i18next";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import { interactionReplyErrorMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { TagService } from "../../application/TagService";
import {
  TAG_STATUS_EMOJIS,
  createTagAddSuccessContainer,
  createTagErrorContainer,
  processTagAttachment,
} from "../views/TagMessageBuilder";

export class TagAddCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("tag-add")
    .setDescription("Create a new tag.")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("name")
        .setDescription("The tag name.")
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(32),
    )
    .addStringOption((o) =>
      o
        .setName("content")
        .setDescription("The content of the tag.")
        .setRequired(false),
    )
    .addAttachmentOption((o) =>
      o
        .setName("attachment")
        .setDescription("Optional tag attachment.")
        .setRequired(false),
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

    const tagName = interaction.options.getString("name")?.toLowerCase();
    if (!tagName) {
      throw new Error("Missing tag name");
    }

    const tagContent = interaction.options.getString("content") || null;
    const tagAttachment = interaction.options.getAttachment("attachment");

    const emojis = await this.emojiRepository.getEmojis(TAG_STATUS_EMOJIS);

    if (!tagContent && !tagAttachment) {
      await interaction.reply({
        components: [
          createTagErrorContainer(
            "Missing Content",
            t("tag.add.error.missing_content_and_attachment", {
              ns: "commands",
            }),
            emojis["fail"],
          ),
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });

      return;
    }

    const embedDataRes = await processTagAttachment(tagContent, tagAttachment);
    if (!embedDataRes.success) {
      await interactionReplyErrorMessage(interaction, embedDataRes.error);
      return;
    }

    const { files } = embedDataRes.data;

    await interaction.reply({
      components: [
        createTagAddSuccessContainer(tagName, tagContent, emojis["success"]),
      ],
      flags: MessageFlags.IsComponentsV2,
      files,
      allowedMentions: { parse: [] },
    });

    let attachmentUrl;
    if (tagAttachment) {
      try {
        const replyMsg = await interaction.fetchReply();
        attachmentUrl = replyMsg.attachments.at(0)?.url;
      } catch {
        await interaction.editReply({
          components: [
            createTagErrorContainer(
              t("tag.add.error.failed_title", { ns: "commands" }),
              t("tag.add.error.failed_get_original_message", {
                ns: "commands",
              }),
              emojis["fail"],
            ),
          ],
          flags: MessageFlags.IsComponentsV2,
        });

        return;
      }
    }

    const result = await this.tagService.createTag({
      name: tagName,
      content: tagContent,
      attachment: attachmentUrl || null,
      guildId: interaction.guildId,
      ownerId: interaction.user.id,
    });

    if (result.err) {
      await interaction.editReply({
        components: [
          createTagErrorContainer(
            t("tag.add.error.failed_title", { ns: "commands" }),
            result.val,
            emojis["fail"],
          ),
        ],
        flags: MessageFlags.IsComponentsV2,
      });
    }
  }
}
