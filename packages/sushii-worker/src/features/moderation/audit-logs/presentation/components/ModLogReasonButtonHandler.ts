import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ActionRowBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import type { Logger } from "pino";

import type { ModerationCaseRepository } from "@/features/moderation/shared/domain/repositories/ModerationCaseRepository";
import { ModLogComponentBuilder } from "@/features/moderation/shared/domain/services/ModLogComponentBuilder";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import buildModLogEmbed from "@/features/moderation/shared/presentation/buildModLogEmbed";
import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/interactions/handlers";

/**
 * Button handler for setting reasons on moderation cases.
 * Integrates button interaction with modal submission using awaitModalSubmit.
 */
export class ModLogReasonButtonHandler extends ButtonHandler {
  customIDMatch = customIds.modLogReason.match;

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

    const customIDMatch = customIds.modLogReason.match(interaction.customId);
    if (!customIDMatch) {
      throw new Error("No mod log reason match");
    }

    const { caseId } = customIDMatch.params;

    // Create and show the modal
    const textInput = new TextInputBuilder()
      .setLabel("Reason")
      .setRequired(true)
      .setPlaceholder("Enter a reason. This will be saved in the mod log.")
      .setStyle(TextInputStyle.Paragraph)
      .setCustomId("reason");

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(
      textInput,
    );

    const modal = {
      title: `Case #${caseId}`,
      custom_id: interaction.customId, // Reuse the same custom ID for matching
      components: [row.toJSON()],
    };

    await interaction.showModal(modal);

    // Await modal submission with 5-minute timeout
    let modalSubmission: ModalSubmitInteraction;
    try {
      modalSubmission = await interaction.awaitModalSubmit({
        time: 300_000, // 5 minutes
        filter: (i) => i.user.id === interaction.user.id,
      });
    } catch {
      // Modal timed out or was dismissed - no need to respond
      this.logger.debug(
        {
          caseId,
          userId: interaction.user.id,
          guildId: interaction.guildId,
        },
        "Modal submission timed out",
      );
      return;
    }

    // Process the modal submission
    await this.processModalSubmission(modalSubmission, caseId);
  }

  private async processModalSubmission(
    interaction: ModalSubmitInteraction,
    caseId: string,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    // Extract the reason from the modal
    const reasonText = interaction.fields.getTextInputValue("reason");
    if (!reasonText) {
      await interaction.reply({
        content: "No reason was provided.",
        ephemeral: true,
      });
      return;
    }

    // Validate the reason
    const reasonResult = Reason.create(reasonText);
    if (reasonResult.err) {
      await interaction.reply({
        content: `Invalid reason: ${reasonResult.val}`,
        ephemeral: true,
      });
      return;
    }

    const reason = reasonResult.val;

    // Fetch the moderation case
    const caseResult = await this.moderationCaseRepository.findById(
      interaction.guildId,
      caseId,
    );

    if (caseResult.err) {
      this.logger.error(
        {
          err: caseResult.val,
          caseId,
          guildId: interaction.guildId,
        },
        "Failed to fetch moderation case",
      );

      await interaction.reply({
        content: "Failed to fetch the moderation case.",
        ephemeral: true,
      });
      return;
    }

    const moderationCase = caseResult.val;
    if (!moderationCase) {
      await interaction.reply({
        content: `Case #${caseId} was not found, it may have been deleted.`,
        ephemeral: true,
      });
      return;
    }

    // Update the case with the new reason and executor
    const updatedCase = moderationCase.withReason(reason);
    const updatedCaseWithExecutor = updatedCase.withExecutor(
      interaction.user.id,
    );

    // Save the updated case
    const updateResult = await this.moderationCaseRepository.update(
      updatedCaseWithExecutor,
    );

    if (updateResult.err) {
      this.logger.error(
        {
          err: updateResult.val,
          caseId,
          guildId: interaction.guildId,
        },
        "Failed to update moderation case with reason",
      );

      await interaction.reply({
        content: `Failed to update case #${caseId}.`,
        ephemeral: true,
      });
      return;
    }

    // Fetch the target user for the embed
    let targetUser;
    try {
      targetUser = await interaction.client.users.fetch(moderationCase.userId);
    } catch (error) {
      this.logger.error(
        {
          err: error,
          userId: moderationCase.userId,
          caseId,
        },
        "Failed to fetch target user",
      );

      await interaction.reply({
        content: "Failed to fetch the target user.",
        ephemeral: true,
      });
      return;
    }

    // Rebuild the embed with the updated case
    const newEmbed = await buildModLogEmbed(
      interaction.client,
      updatedCaseWithExecutor.actionType,
      targetUser,
      {
        case_id: updatedCaseWithExecutor.caseId,
        executor_id: updatedCaseWithExecutor.executorId,
        reason: updatedCaseWithExecutor.reason?.value || null,
        attachments: updatedCaseWithExecutor.attachments,
      },
    );

    // Build updated components (should now show DM buttons if applicable and hide reason button)
    const modLogComponents = new ModLogComponentBuilder(
      updatedCaseWithExecutor.actionType,
      updatedCaseWithExecutor,
    );
    const components = modLogComponents.build();

    // Update the original message via the modal interaction
    if (!interaction.isFromMessage()) {
      throw new Error("Modal should be from a button on a message");
    }

    await interaction.update({
      embeds: [newEmbed.toJSON()],
      components,
    });

    this.logger.info(
      {
        caseId,
        guildId: interaction.guildId,
        executorId: interaction.user.id,
        reason: reasonText,
      },
      "Updated moderation case reason via button interaction",
    );
  }
}
