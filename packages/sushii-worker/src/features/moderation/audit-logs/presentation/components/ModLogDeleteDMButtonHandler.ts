import { sleep } from "bun";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
} from "discord.js";
import { Logger } from "pino";

import { ModerationCaseRepository } from "@/features/moderation/shared/domain/repositories/ModerationCaseRepository";
import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/interactions/handlers";
import Color from "@/utils/colors";

import { ModLogComponents } from "../../domain/entities";

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
      ephemeral: true,
    });

    // Await confirmation with 2 minute timeout
    let confirmButtonInteraction;
    try {
      confirmButtonInteraction = await confirmReplyMsg.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id,
        time: 120_000, // 2 minutes
        componentType: ComponentType.Button,
      });

      if (confirmButtonInteraction.customId === "cancel") {
        await confirmButtonInteraction.update({
          content: "Cancelled!",
          components: [],
          embeds: [],
        });

        // Wait for 2 seconds before deleting the message
        await sleep(2000);
        await confirmButtonInteraction.deleteReply();
        return;
      }

      await confirmButtonInteraction.deferUpdate();
      await confirmReplyMsg.delete();
    } catch {
      // Timed out
      await confirmReplyMsg.delete();
      return;
    }

    // Proceed with DM deletion
    await this.deleteDMAndUpdateMessage(
      confirmButtonInteraction,
      caseId,
      channelId,
      messageId,
    );
  }

  private async deleteDMAndUpdateMessage(
    interaction: ButtonInteraction,
    caseId: string,
    channelId: string,
    messageId: string,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    // Fetch and validate the DM channel
    const dmChannel = await interaction.client.channels.fetch(channelId);
    if (!dmChannel || !dmChannel.isDMBased() || !dmChannel.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle("Failed to delete DM")
        .setDescription("Hmm... couldn't find the channel.")
        .setColor(Color.Error);

      await interaction.followUp({
        embeds: [embed.toJSON()],
        ephemeral: true,
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
          interactionId: interaction.id,
        },
        "Failed to delete DM message",
      );

      const embed = new EmbedBuilder()
        .setTitle("Failed to delete DM")
        .setDescription("Hmm... the message is probably already deleted.")
        .setColor(Color.Error);

      await interaction.followUp({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    // Fetch the moderation case to rebuild components
    const caseResult = await this.moderationCaseRepository.findById(
      interaction.guildId,
      caseId,
    );

    if (caseResult.err) {
      this.logger.warn(
        {
          err: caseResult.val,
          caseId,
          interactionId: interaction.id,
        },
        "Failed to find mod case after DM deletion",
      );

      const embed = new EmbedBuilder()
        .setTitle("Deleted DM")
        .setDescription("Deleted the DM message")
        .setColor(Color.Success);

      await interaction.followUp({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    const moderationCase = caseResult.val;
    if (!moderationCase) {
      this.logger.warn(
        {
          caseId,
          interactionId: interaction.id,
        },
        "Failed to find mod case to delete DM - case not found",
      );

      const embed = new EmbedBuilder()
        .setTitle("Deleted DM")
        .setDescription("Deleted the DM message")
        .setColor(Color.Success);

      await interaction.followUp({
        embeds: [embed],
        ephemeral: true,
      });
      return;
    }

    // Build updated components showing DM as deleted
    const modLogComponents = new ModLogComponents(
      moderationCase.actionType,
      moderationCase,
      true, // dmDeleted = true
    );
    const components = modLogComponents.build();

    // Update the original mod log message
    await interaction.message.edit({
      embeds: interaction.message.embeds,
      components,
    });

    // Send success message
    const embed = new EmbedBuilder()
      .setTitle("Deleted DM")
      .setDescription("Successfully deleted the DM message")
      .setColor(Color.Success);

    await interaction.followUp({
      embeds: [embed],
      ephemeral: true,
    });

    this.logger.info(
      {
        caseId,
        guildId: interaction.guildId,
        executorId: interaction.user.id,
        channelId,
        messageId,
      },
      "Deleted DM message via button interaction",
    );
  }
}
