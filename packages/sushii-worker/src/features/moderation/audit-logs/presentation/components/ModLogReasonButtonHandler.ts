import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import {
  type FieldValues,
  REASON_FORM_EMOJIS,
  type ReasonFormEmojis,
  ReasonFormRetryStore,
  UNRESOLVED_TEMPLATE_MESSAGE,
  buildReasonFormError,
  buildRetryMatcher,
  captureModalValues,
  completeReasonForm,
  prefillModal,
  retryRefusedReply,
  tooLongMessage,
} from "@/features/moderation/actions/presentation/components/reasonFormSubmit";
import type { ReasonUpdateService } from "@/features/moderation/cases/application/ReasonUpdateService";
import {
  buildReasonEditModal,
  buildReasonEditTitle,
} from "@/features/moderation/cases/presentation/views/reasonEditModal";
import type {
  ReasonFormData,
  ReasonTemplateService,
} from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import type { ModLogMessageService } from "@/features/moderation/shared/application/ModLogMessageService";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import { parseReasonFields } from "@/features/moderation/shared/presentation/reasonFields";
import { hasLiveDm } from "@/features/moderation/shared/presentation/views/ModLogMessageView";
import customIds from "@/interactions/customIds";
import { ButtonHandler } from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";

const MODAL_TIMEOUT_MS = 5 * 60 * 1000;

const retryIds = buildRetryMatcher("modLogReason/retry");

interface RetryEntry {
  caseId: string;
  values: FieldValues;
}

function cachedDisplayName(
  interaction: ButtonInteraction<"cached">,
  userId: string | null,
): string | null {
  if (!userId) {
    return null;
  }

  return (
    interaction.guild.members.cache.get(userId)?.displayName ??
    interaction.client.users.cache.get(userId)?.displayName ??
    null
  );
}

/**
 * Set reason / Edit reason on a mod log entry. Opens the shared reason form,
 * saves through ReasonUpdateService and updates the entry in place.
 */
export class ModLogReasonButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) => {
    const token = retryIds.parse(customId);
    if (token) {
      return { path: customId, index: 0, params: { token } };
    }
    return customIds.modLogReason.match(customId);
  };

  private readonly retries = new ReasonFormRetryStore<RetryEntry>();

  constructor(
    private readonly modLogRepository: Pick<ModLogRepository, "findById">,
    private readonly reasonUpdateService: Pick<
      ReasonUpdateService,
      "updateReasons"
    >,
    private readonly reasonTemplateService: Pick<
      ReasonTemplateService,
      "getFormData" | "resolve" | "recordUse" | "create"
    >,
    private readonly modLogMessageService: Pick<
      ModLogMessageService,
      "render" | "syncLegacyDeletedDm" | "updateFromInteraction"
    >,
    private readonly emojiRepository: Pick<BotEmojiRepository, "getEmojis">,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const token = retryIds.parse(interaction.customId);
    if (token) {
      const retry = this.retries.claim(token, interaction.user.id);
      if (retry === "expired" || retry === "wrong_user") {
        await interaction.reply(retryRefusedReply(retry));
        return;
      }

      await this.run(interaction, retry.caseId, { token, ...retry });
      return;
    }

    const params = customIds.modLogReason.matchParams(interaction.customId);
    if (!params) {
      throw new Error("No mod log reason match");
    }

    await this.run(interaction, params.caseId);
  }

  private async run(
    interaction: ButtonInteraction<"cached">,
    caseId: string,
    retry?: RetryEntry & { token: string },
  ): Promise<void> {
    if (
      !(await requireMemberPermission(
        interaction,
        ANY_MOD_PERMISSION.flags,
        ANY_MOD_PERMISSION.name,
      ))
    ) {
      return;
    }

    // Small indexed reads: a modal has to be the first response, so no defer.
    const [found, formData, emojis] = await Promise.all([
      this.modLogRepository.findById(interaction.guildId, caseId),
      this.reasonTemplateService.getFormData(interaction.guildId),
      this.emojiRepository.getEmojis(REASON_FORM_EMOJIS),
    ]);
    if (!found) {
      await interaction.reply({
        content: `Case #${caseId} was not found. It may have been deleted.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // A Try again click comes from the ephemeral error, not the entry.
    const moderationCase = retry
      ? found
      : await this.modLogMessageService.syncLegacyDeletedDm(
          found,
          interaction.message,
        );

    const targetName =
      cachedDisplayName(interaction, moderationCase.userId) ??
      moderationCase.userTag;

    // Unique per click so a collector from a dismissed form can't take a later submit.
    const modalCustomId = retry
      ? `modLogReason/form/${interaction.id}`
      : `${interaction.customId}/n/${interaction.id}`;

    const modal = buildReasonEditModal({
      customId: modalCustomId,
      title: buildReasonEditTitle([caseId], targetName),
      currentReason: moderationCase.reason?.value ?? null,
      formData,
      emojis,
      lastExecutorName: cachedDisplayName(
        interaction,
        formData.last?.executorId ?? null,
      ),
      dmTo: hasLiveDm(moderationCase) ? targetName : null,
    }).toJSON();

    await interaction.showModal(
      retry ? prefillModal(modal, retry.values) : modal,
    );

    let submission: ModalSubmitInteraction;
    try {
      submission = await interaction.awaitModalSubmit({
        time: MODAL_TIMEOUT_MS,
        filter: (i) =>
          i.user.id === interaction.user.id && i.customId === modalCustomId,
      });
    } catch {
      // Rejects only when the form times out or is dismissed.
      this.logger.debug(
        { caseId, userId: interaction.user.id, guildId: interaction.guildId },
        "Mod log reason form timed out",
      );
      return;
    }

    await this.handleSubmit(submission, caseId, formData, emojis, retry?.token);
  }

  private async handleSubmit(
    submission: ModalSubmitInteraction,
    caseId: string,
    formData: ReasonFormData,
    emojis: ReasonFormEmojis,
    retryToken: string | undefined,
  ): Promise<void> {
    if (!submission.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const parsedResult = await parseReasonFields(
      submission.fields,
      formData,
      this.reasonTemplateService,
      submission.guildId,
    );
    if (parsedResult.err) {
      const token = this.retries.put(submission.user.id, {
        caseId,
        values: captureModalValues(submission.fields),
      });
      await submission.reply(
        buildReasonFormError(
          tooLongMessage(parsedResult.val),
          emojis,
          retryIds.build(token),
        ),
      );
      return;
    }

    const parsed = parsedResult.val;
    if (parsed.unresolved) {
      await submission.reply(
        buildReasonFormError(UNRESOLVED_TEMPLATE_MESSAGE, emojis),
      );
      return;
    }

    if (!parsed.text) {
      await submission.reply({
        content: "Nothing changed: pick a template or type a reason.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (retryToken) {
      this.retries.delete(retryToken);
    }

    // Opened from the entry itself: update it in place. Otherwise the service edits it over REST.
    const onEntry =
      !retryToken && submission.isFromMessage() ? submission : null;

    const updateResult = await this.reasonUpdateService.updateReasons({
      guildId: submission.guildId,
      executorId: submission.user.id,
      caseRangeStr: caseId,
      reason: parsed.text,
      onlyEmpty: false,
      updateDm: parsed.updateDm,
      skipModLogRefreshFor: onEntry ? [caseId] : [],
    });
    if (updateResult.err) {
      await submission.reply(buildReasonFormError(updateResult.val, emojis));
      return;
    }

    const [updatedCase] = updateResult.val.updatedCases;
    if (!updatedCase) {
      await submission.reply({
        content: `Case #${caseId} was not found. It may have been deleted.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (onEntry) {
      const message = await this.modLogMessageService.render(updatedCase, {
        currentMessage: onEntry.message,
      });
      const updated = await this.modLogMessageService.updateFromInteraction(
        onEntry,
        message,
      );
      if (updated === "failed") {
        await submission.followUp({
          content: "Saved, but this mod log entry couldn't be updated.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } else if (retryToken && submission.isFromMessage()) {
      // defer: ack-only, the entry was already edited over REST and the error message is removed
      await submission.deferUpdate();
      await submission.deleteReply();
    } else {
      await submission.reply({
        content: `Updated the reason for case #${caseId}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const dmFailed = updateResult.val.dmUpdates.some(
      (u) => u.outcome === "failed" || u.outcome === "skipped_unverified",
    );
    if (dmFailed) {
      await submission.followUp({
        content:
          "Couldn't update the DM. It may be gone, or sushii couldn't check the mod log entry first.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await completeReasonForm(
      submission,
      {
        reasonTemplateService: this.reasonTemplateService,
        emojiRepository: this.emojiRepository,
        logger: this.logger,
      },
      {
        guildId: submission.guildId,
        userId: submission.user.id,
        parsed,
        emojis,
      },
    );

    this.logger.info(
      {
        caseId,
        guildId: submission.guildId,
        userId: submission.user.id,
        templateId: parsed.template?.id,
        updateDm: parsed.updateDm,
      },
      "Updated case reason from the mod log",
    );
  }
}
