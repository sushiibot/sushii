import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Logger } from "pino";

import type { CaseDmDeletionService } from "@/features/moderation/shared/application/CaseDmDeletionService";
import type {
  ModLogMessageService,
  ModLogRenderOptions,
} from "@/features/moderation/shared/application/ModLogMessageService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import { hasLiveDm } from "@/features/moderation/shared/presentation/views/ModLogMessageView";
import {
  matchModLogDmButtonId,
  parseModLogDmButtonId,
} from "@/features/moderation/shared/presentation/views/modLogCustomIds";
import { ButtonHandler } from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";

/**
 * Delete DM on a mod log entry. The first click swaps the entry's buttons for
 * an in-place Delete DM / Cancel confirmation. Also handles the legacy Delete
 * reason DM button on old embed entries.
 */
export class ModLogDeleteDMButtonHandler extends ButtonHandler {
  customIDMatch = matchModLogDmButtonId;

  constructor(
    private readonly modLogRepository: Pick<ModLogRepository, "findById">,
    private readonly caseDmDeletionService: Pick<
      CaseDmDeletionService,
      "deleteDms"
    >,
    private readonly modLogMessageService: Pick<
      ModLogMessageService,
      "render" | "syncLegacyDeletedDm" | "updateFromInteraction"
    >,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const button = parseModLogDmButtonId(interaction.customId);
    if (!button) {
      throw new Error("No mod log delete DM match", {
        cause: { customId: interaction.customId },
      });
    }

    if (
      !(await requireMemberPermission(
        interaction,
        ANY_MOD_PERMISSION.flags,
        ANY_MOD_PERMISSION.name,
      ))
    ) {
      return;
    }

    if (button.action === "deleteConfirm") {
      await this.confirmDelete(interaction, button.caseId);
      return;
    }

    const found = await this.modLogRepository.findById(
      interaction.guildId,
      button.caseId,
    );
    if (!found) {
      await this.replyCaseNotFound(interaction, button.caseId);
      return;
    }

    const moderationCase = await this.modLogMessageService.syncLegacyDeletedDm(
      found,
      interaction.message,
    );

    const hasDmRecord =
      !!moderationCase.dmResult?.channelId &&
      !!moderationCase.dmResult.messageId;
    if (button.action === "delete" && !hasDmRecord) {
      await interaction.reply({
        content: "There's no DM on record for this case.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const confirming = button.action === "delete" && hasLiveDm(moderationCase);
    await this.updateEntry(
      interaction,
      moderationCase,
      { confirmDeleteDm: confirming },
      confirming
        ? "Couldn't show the confirmation on this mod log entry. Try again in a moment."
        : "Couldn't update this mod log entry.",
    );
  }

  private async confirmDelete(
    interaction: ButtonInteraction<"cached">,
    caseId: string,
  ): Promise<void> {
    const [outcome] = await this.caseDmDeletionService.deleteDms(
      interaction.guildId,
      [caseId],
      interaction.user.id,
      { skipModLogRefreshFor: [caseId] },
    );
    if (!outcome?.moderationCase) {
      await this.replyCaseNotFound(interaction, caseId);
      return;
    }

    await this.updateEntry(
      interaction,
      outcome.moderationCase,
      {},
      outcome.result === "deleted"
        ? "Deleted the DM, but this mod log entry couldn't be updated."
        : "Couldn't update this mod log entry.",
    );

    if (outcome.result === "failed") {
      await this.notePrivately(
        interaction,
        "Couldn't delete the DM. Discord refused the request; try again in a moment.",
      );
    }

    this.logger.info(
      {
        caseId,
        guildId: interaction.guildId,
        userId: interaction.user.id,
        result: outcome.result,
      },
      "Handled mod log Delete DM confirmation",
    );
  }

  private async updateEntry(
    interaction: ButtonInteraction<"cached">,
    moderationCase: ModerationCase,
    options: ModLogRenderOptions,
    failureNote: string,
  ): Promise<void> {
    const message = await this.modLogMessageService.render(moderationCase, {
      ...options,
      currentMessage: interaction.message,
    });
    const updated = await this.modLogMessageService.updateFromInteraction(
      interaction,
      message,
    );
    if (updated === "failed") {
      await this.notePrivately(interaction, failureNote);
    }
  }

  /**
   * Best effort. After a legacy entry's deferUpdate, an error reaching the
   * router would edit '@original', which is the mod log entry itself.
   */
  private async notePrivately(
    interaction: ButtonInteraction<"cached">,
    content: string,
  ): Promise<void> {
    try {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } catch (err) {
      this.logger.warn(
        { err, messageId: interaction.message.id },
        "Failed to send mod log Delete DM note",
      );
    }
  }

  private async replyCaseNotFound(
    interaction: ButtonInteraction<"cached">,
    caseId: string,
  ): Promise<void> {
    await interaction.reply({
      content: `Case #${caseId} was not found. It may have been deleted.`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
