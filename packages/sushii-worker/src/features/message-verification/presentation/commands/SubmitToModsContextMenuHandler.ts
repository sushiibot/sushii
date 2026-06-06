import type { ContextMenuCommandInteraction } from "discord.js";
import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ContextMenuCommandBuilder,
  InteractionContextType,
} from "discord.js";
import type { Logger } from "pino";

import ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";

import type { MessageVerificationService } from "../../application/MessageVerificationService";
import type { AttachmentMetadata } from "../../application/types";
import {
  createVerificationSubmitErrorMessage,
  createVerificationSubmitMessage,
} from "../views/VerificationSubmitView";

export class SubmitToModsContextMenuHandler extends ContextMenuHandler {
  command = new ContextMenuCommandBuilder()
    .setName("Submit to Mods")
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    )
    .toJSON();

  constructor(
    private readonly verificationService: MessageVerificationService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ContextMenuCommandInteraction): Promise<void> {
    if (!interaction.isMessageContextMenuCommand()) {
      throw new Error("Not a message context menu command");
    }

    const submitterUserId = interaction.user.id;
    const message = interaction.targetMessage;

    const attachments: AttachmentMetadata[] = message.attachments.map((a) => ({
      filename: a.name,
      contentType: a.contentType,
      size: a.size,
    }));

    try {
      const result = await this.verificationService.submitMessage(
        submitterUserId,
        {
          messageId: message.id,
          channelId: message.channelId,
          authorId: message.author.id,
          authorUsername: message.author.username,
          content: message.content,
          messageTimestamp: message.createdAt,
          attachments,
        },
      );

      await interaction.reply(
        createVerificationSubmitMessage(result.code, result.isRefresh),
      );
    } catch (err) {
      this.logger.error(
        { err, userId: submitterUserId, messageId: message.id },
        "Failed to submit message verification",
      );

      if (interaction.replied || interaction.deferred) {
        return;
      }

      await interaction.reply(createVerificationSubmitErrorMessage());
    }
  }
}
