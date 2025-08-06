import {
  ChatInputCommandInteraction,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { Logger } from "pino";

import { SlashCommandHandler } from "@/interactions/handlers";

import { CaseDeletionService } from "../../application/CaseDeletionService";
import {
  uncaseErrorView,
  uncaseNoCasesView,
  uncaseSuccessView,
} from "../views/UncaseView";

export class UncaseCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("uncase")
    .setDescription("Delete mod cases.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName("case")
        .setDescription(
          "Case numbers you want to delete (e.g., 5, 10-15, latest~3).",
        )
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addBooleanOption((o) =>
      o
        .setName("keep_log_messages")
        .setDescription(
          "Prevent deletion of messages in the mod log for the deleted cases. By default, messages are deleted.",
        )
        .setRequired(false),
    )
    .toJSON();

  constructor(
    private readonly caseDeletionService: CaseDeletionService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    if (!interaction.channel) {
      throw new Error("No channel");
    }

    const caseRangeStr = interaction.options.getString("case", true);
    const keepLogMessages =
      interaction.options.getBoolean("keep_log_messages") ?? false;

    this.logger.debug(
      {
        guildId: interaction.guildId,
        caseRangeStr,
        keepLogMessages,
        executorId: interaction.user.id,
      },
      "Starting case deletion",
    );

    // Defer reply for potentially long-running operations
    await interaction.deferReply();

    const deletionResult = await this.caseDeletionService.deleteCaseRange(
      interaction.guildId,
      caseRangeStr,
      keepLogMessages,
    );

    if (deletionResult.err) {
      this.logger.warn(
        {
          error: deletionResult.val,
          guildId: interaction.guildId,
          caseRangeStr,
        },
        "Case deletion failed",
      );

      await interaction.editReply({
        embeds: [uncaseErrorView(deletionResult.val)],
      });

      return;
    }

    const result = deletionResult.val;

    if (result.affectedCount === 0) {
      await interaction.editReply({
        embeds: [uncaseNoCasesView()],
      });

      return;
    }

    await interaction.editReply({
      embeds: [uncaseSuccessView(result, keepLogMessages)],
    });

    this.logger.info(
      {
        guildId: interaction.guildId,
        caseRangeStr,
        deletedCount: result.affectedCount,
        deletedMessageCount: result.deletedMessageIds.length,
        keepLogMessages,
        executorId: interaction.user.id,
      },
      "Successfully deleted case range",
    );
  }
}
