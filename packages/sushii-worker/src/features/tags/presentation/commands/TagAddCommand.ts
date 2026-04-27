import type { ChatInputCommandInteraction } from "discord.js";
import {
  AttachmentBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} from "discord.js";
import { t } from "i18next";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import { getErrorMessageEdit } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { TagService } from "../../application/TagService";
import {
  TAG_STATUS_EMOJIS,
  createTagAddSuccessContainer,
  createTagErrorContainer,
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

    const tagContent = interaction.options.getString("content") ?? null;
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

    if (tagAttachment) {
      // Defer before slow work — gives 15 minutes for the upload + DB write
      await interaction.deferReply();

      // Inline download: fetch the attachment from Discord
      let file: AttachmentBuilder;
      try {
        const response = await fetch(tagAttachment.url);
        if (!response.ok) {
          this.logger.warn(
            { status: response.status, attachmentUrl: tagAttachment.url, tagName, guildId: interaction.guildId },
            "Tag attachment fetch returned non-OK status",
          );
          await interaction.editReply(
            getErrorMessageEdit(
              "Error",
              `Failed to fetch attachment (HTTP ${response.status}).`,
            ),
          );
          return;
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        file = new AttachmentBuilder(buffer).setName(tagAttachment.name);
      } catch (err) {
        this.logger.warn(
          { err, attachmentUrl: tagAttachment.url, tagName, guildId: interaction.guildId },
          "Failed to fetch tag attachment from Discord",
        );
        await interaction.editReply(
          getErrorMessageEdit("Error", "Failed to fetch attachment from Discord."),
        );
        return;
      }

      const validateRes = await this.tagService.validateNewTag(
        tagName,
        interaction.guildId,
      );
      if (validateRes.err) {
        await interaction.editReply(
          getErrorMessageEdit(
            t("tag.add.error.failed_title", { ns: "commands" }),
            validateRes.val,
          ),
        );
        return;
      }

      // Single combined edit: send success message AND file together so
      // IsComponentsV2 is set on the initial commit (Discord rejects adding it later)
      await interaction.editReply({
        components: [createTagAddSuccessContainer(tagName, tagContent, emojis["success"])],
        files: [file],
        flags: MessageFlags.IsComponentsV2,
      });

      const replyMsg = await interaction.fetchReply();
      const attachmentUrl = replyMsg.attachments.at(0)?.url ?? null;

      if (attachmentUrl === null) {
        this.logger.warn(
          { tagName, guildId: interaction.guildId },
          "Attachment URL missing from interaction reply",
        );
        await interaction.editReply({
          ...getErrorMessageEdit(
            t("tag.add.error.failed_title", { ns: "commands" }),
            t("tag.add.error.failed_get_original_message", { ns: "commands" }),
          ),
          files: [],
        });
        return;
      }

      const createRes = await this.tagService.createTag({
        name: tagName,
        content: tagContent,
        attachment: attachmentUrl,
        guildId: interaction.guildId,
        ownerId: interaction.user.id,
      });

      if (createRes.err) {
        await interaction.editReply({
          ...getErrorMessageEdit(
            t("tag.add.error.failed_title", { ns: "commands" }),
            createRes.val,
          ),
          files: [],
        });
        return;
      }

      return;
    }

    const result = await this.tagService.createTag({
      name: tagName,
      content: tagContent,
      attachment: null,
      guildId: interaction.guildId,
      ownerId: interaction.user.id,
    });

    if (result.err) {
      await interaction.reply({
        components: [
          createTagErrorContainer(
            t("tag.add.error.failed_title", { ns: "commands" }),
            result.val,
            emojis["fail"],
          ),
        ],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      return;
    }

    await interaction.reply({
      components: [
        createTagAddSuccessContainer(tagName, tagContent, emojis["success"]),
      ],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  }
}
