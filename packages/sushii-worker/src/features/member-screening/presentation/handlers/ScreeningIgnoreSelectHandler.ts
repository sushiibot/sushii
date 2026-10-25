import type { AnySelectMenuInteraction, ButtonInteraction } from "discord.js";
import { MessageFlags, PermissionFlagsBits } from "discord.js";
import type { Logger } from "pino";

import customIds from "@/interactions/customIds";
import { SelectMenuHandler } from "@/shared/presentation/handlers";
import { requireMemberPermission } from "@/shared/presentation/requireMemberPermission";

import type { ScreeningPostRenderer } from "../../application/ScreeningPostRenderer";
import type { ScreeningMetrics } from "../../domain/ScreeningMetrics";
import type { ScreeningVerdictRepository } from "../../domain/repositories/ScreeningVerdictRepository";
import { IGNORE_REASONS, type IgnoreReason } from "../../domain/types";

function isIgnoreReason(value: string | undefined): value is IgnoreReason {
  return IGNORE_REASONS.some((reason) => reason === value);
}

export class ScreeningIgnoreSelectHandler extends SelectMenuHandler {
  customIDMatch = customIds.screeningIgnore.match;

  constructor(
    private readonly verdictRepo: ScreeningVerdictRepository,
    private readonly renderer: Pick<ScreeningPostRenderer, "renderPost">,
    private readonly metrics: ScreeningMetrics,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(
    interaction: AnySelectMenuInteraction,
  ): Promise<void> {
    if (!interaction.inCachedGuild() || !interaction.isStringSelectMenu()) {
      throw new Error("Not a cached guild string select interaction");
    }

    const params = customIds.screeningIgnore.matchParams(interaction.customId);
    if (!params) {
      throw new Error("No screening ignore match");
    }

    // requireMemberPermission only reads memberPermissions and calls reply, both shared by every component interaction.
    if (
      !(await requireMemberPermission(
        interaction as unknown as ButtonInteraction<"cached">,
        PermissionFlagsBits.ManageMessages,
        "Manage Messages",
      ))
    ) {
      return;
    }

    const reason = interaction.values[0];
    if (!isIgnoreReason(reason)) {
      await interaction.reply({
        content: "Unknown ignore reason.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const verdictId = Number(params.verdictId);
    if (!Number.isSafeInteger(verdictId) || verdictId <= 0) {
      throw new Error("Invalid screening verdict id", {
        cause: { verdictId: params.verdictId },
      });
    }

    const verdict = await this.verdictRepo.findById(verdictId);
    if (!verdict || verdict.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "This flag no longer exists.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const postMessageId = interaction.message.id;
    const changed = await this.verdictRepo.setIgnored(
      postMessageId,
      interaction.user.id,
      reason,
      new Date(),
    );

    if (changed.length === 0) {
      await interaction.deferUpdate();
      return;
    }

    const container = await this.renderer.renderPost(postMessageId);
    if (!container) {
      throw new Error("Ignored screening post has no verdict", {
        cause: { postMessageId },
      });
    }

    await interaction.update({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });

    this.metrics.recordOutcome("ignored", { source: "button", reason });
    this.logger.info(
      {
        guildId: interaction.guildId,
        postMessageId,
        verdictId: verdict.id,
        reason,
        executorId: interaction.user.id,
        changed: changed.length,
      },
      "Screening post ignored",
    );
  }
}
