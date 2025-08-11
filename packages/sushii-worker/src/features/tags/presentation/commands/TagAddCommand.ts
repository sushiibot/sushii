import type { ChatInputCommandInteraction } from "discord.js";
import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { t } from "i18next";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";
import { interactionReplyErrorMessage } from "@/interactions/responses/error";

import type { TagService } from "../../application/TagService";
import {
  createTagErrorEmbed,
  createTagSuccessEmbed,
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

    if (!tagContent && !tagAttachment) {
      await interaction.reply({
        embeds: [
          createTagErrorEmbed(
            "Missing Content",
            t("tag.add.error.missing_content_and_attachment", {
              ns: "commands",
            }),
          ).toJSON(),
        ],
      });
      return;
    }

    const embedDataRes = await processTagAttachment(tagContent, tagAttachment);
    if (!embedDataRes.success) {
      await interactionReplyErrorMessage(interaction, embedDataRes.error);
      return;
    }

    const { fields, files } = embedDataRes.data;

    const embed = createTagSuccessEmbed(
      t("tag.add.success.title", { ns: "commands", tagName }),
      fields,
      tagAttachment?.url,
    );

    await interaction.reply({
      embeds: [embed],
      files,
    });

    let attachmentUrl;
    if (tagAttachment) {
      try {
        const replyMsg = await interaction.fetchReply();
        attachmentUrl = replyMsg.attachments.at(0)?.url;
      } catch {
        await interaction.editReply({
          embeds: [
            createTagErrorEmbed(
              t("tag.add.error.failed_title", { ns: "commands" }),
              t("tag.add.error.failed_get_original_message", {
                ns: "commands",
              }),
            ),
          ],
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
        embeds: [
          createTagErrorEmbed(
            t("tag.add.error.failed_title", { ns: "commands" }),
            result.val,
          ),
        ],
      });
    }
  }
}
