import { ComponentType } from "discord-api-types/v10";
import { ButtonStyle, MessageFlags, type ButtonInteraction } from "discord.js";
import type { Logger } from "pino";

import { parseRemoveTimeoutId } from "@/features/automod/presentation/handlers/automodAlertExtraCustomIds";
import { disableAlertButton } from "@/features/automod/utils/alertComponentUtils";
import type { ModerationService } from "@/features/moderation/actions/application/ModerationService";
import { UnTimeoutAction } from "@/features/moderation/shared/domain/entities/ModerationAction";
import { ModerationTarget } from "@/features/moderation/shared/domain/entities/ModerationTarget";
import { ButtonHandler } from "@/shared/presentation/handlers";

export class AutomodAlertRemoveTimeoutButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    parseRemoveTimeoutId(customId) !== null
      ? { path: customId, index: 0, params: {} }
      : false;

  constructor(
    private readonly moderationService: ModerationService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const userId = parseRemoveTimeoutId(interaction.customId);
    if (!userId) {
      throw new Error("No remove timeout match");
    }

    // Ack immediately — the untimeout below is a Discord REST call plus a DB
    // write and can exceed Discord's 3s interaction-token window under load.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let member;
    try {
      member = await interaction.guild.members.fetch(userId);
    } catch {
      member = null;
    }

    if (!member) {
      await interaction.editReply({
        content: "Couldn't find that member — they may have left the server.",
      });
      return;
    }

    const action = new UnTimeoutAction(
      interaction.guildId,
      interaction.user,
      interaction.member,
      null,
      "unspecified",
    );

    const results = await this.moderationService.executeAction(action, [
      new ModerationTarget(member.user, member),
    ]);

    const result = results[0];
    if (!result || result.err) {
      this.logger.warn(
        { userId, executorId: interaction.user.id, err: result?.val },
        "Failed to remove timeout from automod alert",
      );
      await interaction.editReply({
        content: `Failed to remove timeout: ${result?.val ?? "unknown error"}`,
      });
      return;
    }

    await interaction.editReply({
      content: "Timeout removed.",
    });

    await disableAlertButton(
      interaction,
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "Timeout Removed",
        custom_id: interaction.customId,
        disabled: true,
      },
      this.logger,
      { userId },
    );
  }
}
