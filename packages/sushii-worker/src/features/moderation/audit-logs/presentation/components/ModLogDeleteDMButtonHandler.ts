import { sleep } from "bun";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
import { Logger } from "pino";

import { ModerationCaseRepository } from "@/features/moderation/shared/domain/repositories/ModerationCaseRepository";
import { ModLogComponentBuilder } from "@/features/moderation/shared/domain/services/ModLogComponentBuilder";
import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/interactions/handlers";
import Color from "@/utils/colors";

/**
 * Button handler for deleting DM messages sent to users for moderation cases.
 * Uses awaitMessageComponent for confirmation with a 2-minute timeout.
 */
export class ModLogDeleteDMButtonHandler extends ButtonHandler {
  customIDMatch = customIds.modLogDeleteReasonDM.match;

  constructor(
    private readonly moderationCaseRepository: ModerationCaseRepository,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const customIDMatch = customIds.modLogDeleteReasonDM.match(
      interaction.customId,
    );
    if (!customIDMatch) {
      throw new Error(
        `No match for mod log delete reason DM button with custom Id: ${interaction.customId}`,
      );
    }

    const { caseId, channelId, messageId } = customIDMatch.params;

    // Show confirmation dialog
    const confirmationEmbed = new EmbedBuilder()
      .setTitle("Are you sure?")
      .setDescription(
        "This will delete the DM sent to the user containing the reason.",
      )
      .setColor(Color.Warning);

    const confirmationCancelButton = new ButtonBuilder()
      .setCustomId("cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    const confirmationYesButton = new ButtonBuilder()
      .setCustomId("yes")
      .setLabel("Yes")
      .setStyle(ButtonStyle.Danger);

    const confirmationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      confirmationCancelButton,
      confirmationYesButton,
    );

    const confirmReplyMsg = await interaction.reply({
      embeds: [confirmationEmbed],
      components: [confirmationRow],
      flags: MessageFlags.Ephemeral,
      // Required to await button interaction
      withResponse: true,
    });

    if (!confirmReplyMsg.resource?.message) {
      throw new Error(
        "Failed to get confirmation message for mod log delete DM button",
      );
    }

    // Await confirmation with 2 minute timeout
    let confirmButtonInteraction;
    try {
      confirmButtonInteraction =
        await confirmReplyMsg.resource.message.awaitMessageComponent({
          filter: (i) => i.user.id === interaction.user.id,
          time: 120_000, // 2 minutes
          componentType: ComponentType.Button,
        });

      this.logger.debug(
        {
          caseId,
          userId: confirmButtonInteraction.user.id,
          guildId: confirmButtonInteraction.guildId,
          customId: confirmButtonInteraction.customId,
        },
        "Received button for mod log delete DM button",
      );

      if (confirmButtonInteraction.customId === "cancel") {
        // Just delete the confirmation message
        // NOTE: We delete the initial button reply, not the confirmation interaction
        await interaction.deleteReply();
        return;
      }
    } catch {
      // Timed out
      await interaction.deleteReply();
      return;
    }

    // Proceed with DM deletion
    await this.deleteDMAndUpdateMessage(
      interaction,
      confirmButtonInteraction,
      caseId,
      channelId,
      messageId,
    );
  }

  private async deleteDMAndUpdateMessage(
    originalInteraction: ButtonInteraction,
    confirmationInteraction: ButtonInteraction,
    caseId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    if (!confirmationInteraction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    // Fetch and validate the DM channel
    const dmChannel =
      await confirmationInteraction.client.channels.fetch(channelId);
    if (!dmChannel || !dmChannel.isDMBased() || !dmChannel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle("Failed to delete DM")
        .setDescription("Hmm... couldn't find the channel.")
        .setColor(Color.Error);

      await confirmationInteraction.update({
        embeds: [embed.toJSON()],
      });

      return;
    }

    // Try to delete the DM
    try {
      await dmChannel.messages.delete(messageId);
    } catch (err) {
      this.logger.warn(
        {
          err,
          channelId,
          messageId,
          caseId,
          interactionId: confirmationInteraction.id,
        },
        "Failed to delete DM message",
      );

      // Ignore just continue and mark as deleted, since it might just already
      // be deleted... if it's already deleted then there isn't point telling
      // the user it failed
    }

    // Fetch the moderation case to rebuild components
    const caseResult = await this.moderationCaseRepository.findById(
      confirmationInteraction.guildId,
      caseId,
    );

    if (caseResult.err) {
      this.logger.warn(
        {
          err: caseResult.val,
          caseId,
          interactionId: confirmationInteraction.id,
        },
        "Failed to find mod case after DM deletion",
      );

      const embed = new EmbedBuilder()
        .setTitle("Deleted DM")
        .setDescription("Deleted the DM message")
        .setColor(Color.Success);

      await confirmationInteraction.editReply({
        embeds: [embed],
      });

      return;
    }

    const moderationCase = caseResult.val;
    if (!moderationCase) {
      throw new Error(
        `Case #${caseId} was not found, it may have been deleted.`,
      );
    }

    // Build updated components showing DM as deleted
    const modLogComponents = new ModLogComponentBuilder(
      moderationCase.actionType,
      moderationCase,
      true, // dmDeleted = true
    );
    const components = modLogComponents.build();

    // Update the original mod log message
    await originalInteraction.editReply({
      message: originalInteraction.message,
      embeds: originalInteraction.message.embeds,
      components,
    });

    await originalInteraction.deleteReply();

    this.logger.info(
      {
        caseId,
        guildId: confirmationInteraction.guildId,
        executorId: confirmationInteraction.user.id,
        channelId,
        messageId,
      },
      "Deleted DM message via button interaction",
    );
  }
}
