import { ComponentType } from "discord-api-types/v10";
import { ButtonStyle, MessageFlags, type ButtonInteraction } from "discord.js";
import type { Logger } from "pino";

import { ButtonHandler } from "@/shared/presentation/handlers";

import type { ScamHashReportService } from "../../application/ScamHashReportService";
import { disableAlertButton } from "../../utils/alertComponentUtils";
import {
  parseReportDismissId,
  parseReportHashId,
  parseReportRevertId,
} from "./automodAlertExtraCustomIds";

export class ScamHashReportButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    parseReportHashId(customId) !== null ||
    parseReportRevertId(customId) !== null ||
    parseReportDismissId(customId) !== null
      ? { path: customId, index: 0, params: {} }
      : false;

  constructor(
    private readonly service: ScamHashReportService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    const reportHashId = parseReportHashId(interaction.customId);
    if (reportHashId !== null) {
      await this.handleReport(reportHashId, interaction);
      return;
    }

    const revertReportId = parseReportRevertId(interaction.customId);
    if (revertReportId !== null) {
      await this.service.handleRevert(revertReportId, interaction);
      return;
    }

    const dismissReportId = parseReportDismissId(interaction.customId);
    if (dismissReportId !== null) {
      await this.service.handleDismiss(dismissReportId, interaction);
    }
  }

  private async handleReport(
    hashId: number,
    interaction: ButtonInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await this.service.submitReport({
      hashId,
      reporterId: interaction.user.id,
      guildId: interaction.guildId,
      guildName: interaction.guild.name,
    });

    if (!result.ok) {
      await interaction.editReply({
        content: "Couldn't send this for review — the hash entry may already be gone.",
      });
      return;
    }

    await interaction.editReply({
      content: "Sent for review, thank you!",
    });

    await disableAlertButton(
      interaction,
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "Reported",
        custom_id: interaction.customId,
        disabled: true,
      },
      this.logger,
      { hashId },
    );
  }
}
