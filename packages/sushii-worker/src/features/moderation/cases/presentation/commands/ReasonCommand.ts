import type { ChatInputCommandInteraction } from "discord.js";
import {
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import customIds from "@/interactions/customIds";
import { interactionReplyErrorPlainMessage } from "@/interactions/responses/error";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { ReasonUpdateService } from "../../application/ReasonUpdateService";
import {
  reasonCancelledView,
  reasonErrorView,
  reasonExpiredView,
  reasonInvalidRangeView,
  reasonNoCasesView,
  reasonSuccessView,
  reasonWarningView,
} from "../views/ReasonView";

export class ReasonCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("reason")
    .setDescription("Set the reason for mod cases.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("case")
        .setDescription("Case numbers you want to set the reason for.")
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addStringOption((o) =>
      o
        .setName("reason")
        .setDescription("Reason for the mod case.")
        .setRequired(true),
    )
    .toJSON();

  constructor(
    private readonly reasonUpdateService: ReasonUpdateService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const caseRangeStr = interaction.options.getString("case", true);
    const reason = interaction.options.getString("reason", true);

    this.logger.debug(
      {
        guildId: interaction.guildId,
        caseRangeStr,
        reason,
        executorId: interaction.user.id,
      },
      "Starting reason update",
    );

    // Check for existing reasons to determine if confirmation is needed
    const checkResult = await this.reasonUpdateService.checkExistingReasons(
      interaction.guildId,
      caseRangeStr,
    );

    if (checkResult.err) {
      if (
        checkResult.val.includes("Invalid case range") ||
        checkResult.val.includes("Please specify the end case ID")
      ) {
        await interaction.reply({
          embeds: [reasonInvalidRangeView()],
        });
        return;
      }

      if (checkResult.val.includes("25 cases")) {
        await interactionReplyErrorPlainMessage(interaction, checkResult.val);
        return;
      }

      await interaction.reply({
        embeds: [reasonErrorView(checkResult.val)],
      });
      return;
    }

    const { cases, hasExistingReasons } = checkResult.val;

    if (cases.length === 0) {
      await interaction.reply({
        embeds: [reasonInvalidRangeView()],
      });
      return;
    }

    // If cases have existing reasons, show confirmation dialog
    if (hasExistingReasons) {
      await this.handleConfirmationFlow(
        interaction,
        cases,
        caseRangeStr,
        reason,
      );
      return;
    }

    // No confirmation needed, proceed directly
    await this.executeReasonUpdate(
      interaction,
      caseRangeStr,
      reason,
      false, // Update all cases, not just empty
    );
  }

  private async handleConfirmationFlow(
    interaction: ChatInputCommandInteraction<"cached">,
    cases: ModerationCase[],
    caseRangeStr: string,
    reason: string,
  ): Promise<void> {
    const casesWithReason = cases.filter((c) => c.reason !== null);
    const { embed, components } = reasonWarningView(
      casesWithReason,
      cases.length,
      reason,
      casesWithReason.length === cases.length, // Hide partial update if all have reasons
    );

    const interactionResponse = await interaction.reply({
      embeds: [embed],
      components: [components],
    });

    const collector = interactionResponse.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 2 * 60 * 1000, // 2 minutes
    });

    collector.on("collect", async (buttonInteraction) => {
      // Check if the button was clicked by the same user who ran the command
      if (buttonInteraction.user.id !== interaction.user.id) {
        await buttonInteraction.reply({
          embeds: [
            reasonErrorView("You can only confirm your own reason command :("),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const customIDMatch = customIds.reasonConfirmButton.match(
        buttonInteraction.customId,
      );
      if (!customIDMatch) {
        return;
      }

      const { action } = customIDMatch.params;

      if (action === "cancel") {
        await buttonInteraction.update({
          embeds: [reasonCancelledView()],
          components: [],
        });
        collector.stop();
        return;
      }

      const onlyEmpty = action === "empty";

      // Execute the reason update
      const updateResult = await this.reasonUpdateService.updateReasons({
        guildId: interaction.guildId,
        executorId: buttonInteraction.user.id,
        caseRangeStr,
        reason,
        onlyEmpty,
      });

      if (updateResult.err) {
        await buttonInteraction.update({
          embeds: [reasonErrorView(updateResult.val)],
          components: [],
        });
        collector.stop();
        return;
      }

      const result = updateResult.val;

      if (result.updatedCases.length === 0) {
        await buttonInteraction.update({
          embeds: [reasonNoCasesView()],
          components: [],
        });
        collector.stop();
        return;
      }

      const successEmbed = reasonSuccessView(result, reason, caseRangeStr);
      await buttonInteraction.update({
        embeds: [successEmbed],
        components: [],
      });

      collector.stop();
    });

    // Handle collector timeout
    collector.on("end", async (collected, endReason) => {
      if (endReason === "time" && collected.size === 0) {
        this.logger.debug(
          { interactionId: interaction.id },
          "Confirmation message is still pending, deleting",
        );

        await interaction.editReply({
          embeds: [reasonExpiredView()],
          components: [],
        });
      }
    });
  }

  private async executeReasonUpdate(
    interaction: ChatInputCommandInteraction<"cached">,
    caseRangeStr: string,
    reason: string,
    onlyEmpty: boolean,
  ): Promise<void> {
    // Defer reply for potentially long-running operations
    await interaction.deferReply();

    const updateResult = await this.reasonUpdateService.updateReasons({
      guildId: interaction.guildId,
      executorId: interaction.user.id,
      caseRangeStr,
      reason,
      onlyEmpty,
    });

    if (updateResult.err) {
      await interaction.editReply({
        embeds: [reasonErrorView(updateResult.val)],
      });
      return;
    }

    const result = updateResult.val;

    if (result.updatedCases.length === 0) {
      await interaction.editReply({
        embeds: [reasonNoCasesView()],
      });
      return;
    }

    const successEmbed = reasonSuccessView(result, reason, caseRangeStr);
    await interaction.editReply({
      embeds: [successEmbed],
    });
  }
}
