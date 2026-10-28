import type { ChatInputCommandInteraction } from "discord.js";
import {
  ApplicationIntegrationType,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { ReasonTemplateService } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { REASON_MAX_LENGTH } from "@/features/moderation/shared/domain/value-objects/Reason";
import { UNRESOLVED_TEMPLATE_MESSAGE } from "@/features/moderation/shared/presentation/reasonFields";
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
  reasonUpdatingView,
  reasonWarningView,
} from "../views/ReasonView";

export class ReasonCommand extends SlashCommandHandler {
  command = new SlashCommandBuilder()
    .setName("reason")
    .setDescription("Set the reason for mod cases.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
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
        .setDescription("New reason. Pick a template or type !shortcut.")
        .setMaxLength(REASON_MAX_LENGTH)
        .setAutocomplete(true)
        .setRequired(true),
    )
    .addBooleanOption((o) =>
      o
        .setName("update_dm")
        .setDescription("Also update the DM sent to the user")
        .setRequired(false),
    )
    .toJSON();

  constructor(
    private readonly reasonUpdateService: ReasonUpdateService,
    private readonly reasonTemplateService: Pick<
      ReasonTemplateService,
      "resolve" | "recordUse"
    >,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached");
    }

    const caseRangeStr = interaction.options.getString("case", true);
    const input = interaction.options.getString("reason", true);
    const updateDm = interaction.options.getBoolean("update_dm") ?? false;

    const expanded = await this.reasonTemplateService.resolve(
      interaction.guildId,
      input,
    );
    if (expanded?.unresolved) {
      await interactionReplyErrorPlainMessage(
        interaction,
        UNRESOLVED_TEMPLATE_MESSAGE,
        true,
      );
      return;
    }

    const reason = expanded?.text ?? input.trim();
    if (reason.length > REASON_MAX_LENGTH) {
      await interactionReplyErrorPlainMessage(
        interaction,
        tooLongCommandMessage(reason.length, expanded?.template?.shortcut),
        true,
      );
      return;
    }

    const update: PendingReasonUpdate = {
      caseRangeStr,
      reason,
      updateDm,
      templateId: expanded?.template?.id ?? null,
    };

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
      await this.handleConfirmationFlow(interaction, cases, update);
      return;
    }

    // No confirmation needed, proceed directly
    await this.executeReasonUpdate(interaction, update, false);
  }

  private async handleConfirmationFlow(
    interaction: ChatInputCommandInteraction<"cached">,
    cases: ModerationCase[],
    update: PendingReasonUpdate,
  ): Promise<void> {
    const { caseRangeStr, reason } = update;
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

    let started = false;
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

      // A second click can land before the buttons disappear.
      if (started) {
        await buttonInteraction.reply({
          content: "These cases are already being updated.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (action === "cancel") {
        await buttonInteraction.update({
          embeds: [reasonCancelledView()],
          components: [],
        });
        collector.stop();
        return;
      }

      const onlyEmpty = action === "empty";
      started = true;

      try {
        await buttonInteraction.update({
          embeds: [reasonUpdatingView()],
          components: [],
        });

        const updateResult = await this.reasonUpdateService.updateReasons({
          guildId: interaction.guildId,
          executorId: buttonInteraction.user.id,
          caseRangeStr,
          reason,
          onlyEmpty,
          updateDm: update.updateDm,
        });

        if (updateResult.err) {
          await buttonInteraction.editReply({
            embeds: [reasonErrorView(updateResult.val)],
            components: [],
          });
          return;
        }

        const result = updateResult.val;

        if (result.updatedCases.length === 0) {
          await buttonInteraction.editReply({
            embeds: [reasonNoCasesView()],
            components: [],
          });
          return;
        }

        await this.recordTemplateUse(interaction.guildId, update);

        await buttonInteraction.editReply({
          embeds: [reasonSuccessView(result, reason, caseRangeStr)],
          components: [],
        });
      } catch (err) {
        // Collector listeners never reach the router, so this is the only place it's logged.
        this.logger.error(
          { err, guildId: interaction.guildId, caseRangeStr },
          "Failed to update reasons after confirmation",
        );
        await buttonInteraction
          .editReply({
            embeds: [
              reasonErrorView("Something went wrong updating these cases."),
            ],
            components: [],
          })
          .catch((editErr: unknown) => {
            this.logger.warn(
              { err: editErr },
              "Failed to show reason update error",
            );
          });
      } finally {
        collector.stop();
      }
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
    update: PendingReasonUpdate,
    onlyEmpty: boolean,
  ): Promise<void> {
    const { caseRangeStr, reason } = update;
    // defer: fetches and edits the mod log message of every case in the range
    await interaction.deferReply();

    const updateResult = await this.reasonUpdateService.updateReasons({
      guildId: interaction.guildId,
      executorId: interaction.user.id,
      caseRangeStr,
      reason,
      onlyEmpty,
      updateDm: update.updateDm,
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

    await this.recordTemplateUse(interaction.guildId, update);

    const successEmbed = reasonSuccessView(result, reason, caseRangeStr);
    await interaction.editReply({
      embeds: [successEmbed],
    });
  }

  private async recordTemplateUse(
    guildId: string,
    update: PendingReasonUpdate,
  ): Promise<void> {
    if (update.templateId) {
      await this.reasonTemplateService.recordUse(guildId, update.templateId);
    }
  }
}

interface PendingReasonUpdate {
  caseRangeStr: string;
  /** Expanded from any template or !shortcut. */
  reason: string;
  updateDm: boolean;
  templateId: string | null;
}

function tooLongCommandMessage(
  length: number,
  shortcut: string | null | undefined,
): string {
  const number = new Intl.NumberFormat("en-US");
  const source = shortcut ? `expanding \`!${shortcut}\`` : "expanding it";
  return `**Nothing was done.** The reason is ${number.format(length)} characters after ${source}; the limit is ${number.format(REASON_MAX_LENGTH)}. Shorten the extra text by ${number.format(length - REASON_MAX_LENGTH)} characters.`;
}
