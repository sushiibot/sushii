import type {
  APIMessageTopLevelComponent,
  ButtonInteraction,
  InteractionReplyOptions,
  Message,
  ModalSubmitInteraction,
} from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type {
  ReasonUpdateResult,
  ReasonUpdateService,
} from "@/features/moderation/cases/application/ReasonUpdateService";
import {
  buildReasonEditModal,
  buildReasonEditTitle,
} from "@/features/moderation/cases/presentation/views/reasonEditModal";
import type {
  ReasonFormData,
  ReasonTemplateService,
} from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import { showSaveTemplateModal } from "@/features/moderation/reason-templates/presentation/showSaveTemplateModal";
import type { CaseDmDeletionService } from "@/features/moderation/shared/application/CaseDmDeletionService";
import type { ModLogRefreshOutcome } from "@/features/moderation/shared/application/ModLogMessageService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type {
  ActionResponseButtonKind,
  ActionResponseButtonOutcome,
  ModerationMetrics,
} from "@/features/moderation/shared/domain/metrics/ModerationMetrics";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  type ParsedReasonFields,
  parseReasonFields,
} from "@/features/moderation/shared/presentation/reasonFields";
import { hasLiveDm } from "@/features/moderation/shared/presentation/views/ModLogMessageView";
import { ButtonHandler } from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";
import Color from "@/utils/colors";

import {
  type FieldValues,
  REASON_FORM_EMOJIS,
  ReasonFormRetryStore,
  UNRESOLVED_TEMPLATE_MESSAGE,
  buildReasonFormError,
  buildRetryMatcher,
  captureModalValues,
  completeReasonForm,
  prefillModal,
  retryRefusedReply,
  tooLongMessage,
} from "../components/reasonFormSubmit";
import {
  EXPIRED_CLICK_MESSAGE,
  MODERATION_ACTION_EMOJIS,
  RESPONSE_WINDOW_MS,
  type ResponseBodyInput,
  type ResponseMode,
  editedNote,
  expireActionResponse,
  hasSavePrompt,
  isResponseExpired,
  rebuildActionResponse,
  showsExpiredLine,
  templateNote,
  unknownShortcutNote,
} from "../views/ModerationActionView";
import {
  type ResponseButton,
  buildResponseModalId,
  matchResponseButtonId,
  parseResponseButtonId,
  toCaseRuns,
} from "./customIds";

export const ACTION_RESPONSE_EMOJIS = [
  ...MODERATION_ACTION_EMOJIS,
  ...REASON_FORM_EMOJIS,
] as const satisfies readonly BotEmojiNameType[];

type Emojis = EmojiMap<typeof ACTION_RESPONSE_EMOJIS>;

type MessageInteraction =
  | ButtonInteraction<"cached">
  | ModalSubmitInteraction<"cached">;

export interface ActionResponseDeps {
  modLogRepository: Pick<ModLogRepository, "findByIds">;
  reasonUpdateService: Pick<ReasonUpdateService, "updateReasons">;
  caseDmDeletionService: Pick<CaseDmDeletionService, "deleteDms">;
  reasonTemplateService: Pick<
    ReasonTemplateService,
    "getFormData" | "resolve" | "recordUse" | "create" | "shouldPromptSave"
  >;
  emojiRepository: Pick<BotEmojiRepository, "getEmojis">;
  metrics: Pick<
    ModerationMetrics,
    "recordReasonResolved" | "recordSavePrompt" | "recordActionResponseButton"
  >;
  logger: Logger;
  now?: () => number;
}

/** null: not counted, e.g. a Delete DM click that only opens the confirm step. */
type ClickOutcome = ActionResponseButtonOutcome | null;

const METRIC_BUTTON: Record<ResponseButton["kind"], ActionResponseButtonKind> =
  {
    edit: "edit_reason",
    dmDelete: "delete_dm",
    dmCancel: "delete_dm",
    dmDeleteConfirm: "delete_dm",
    save: "save_template",
  };

function ephemeral(text: string, accent: number): InteractionReplyOptions {
  return {
    components: [
      new ContainerBuilder()
        .setAccentColor(accent)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(text)),
    ],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
}

type PostedResponse = Pick<Message, "createdTimestamp" | "components">;
type ResponseMessage = PostedResponse & Pick<Message, "edit">;

type RenderBody = Omit<ResponseBodyInput, "reasonNotes" | "mode"> & {
  reasonNotes?: readonly string[];
  mode?: ResponseMode;
};

interface RetryEntry {
  caseIds: string[];
  values: FieldValues;
  response: ResponseMessage;
}

const retryIds = buildRetryMatcher("modAction/reasonRetry");

// A submit after the window still lands: it renders the expired state.
const MIN_FORM_TIMEOUT_MS = 5 * 60 * 1000;

/** The form stays open for what's left of the window, but at least five minutes. */
export function formTimeoutMs(createdTimestamp: number, now: number): number {
  return Math.max(
    MIN_FORM_TIMEOUT_MS,
    createdTimestamp + RESPONSE_WINDOW_MS - now,
  );
}

function postedOf(message: PostedResponse): APIMessageTopLevelComponent[] {
  return message.components.map((c) => c.toJSON());
}

function postedComponents(
  interaction: MessageInteraction,
): APIMessageTopLevelComponent[] {
  return interaction.message ? postedOf(interaction.message) : [];
}

function displayName(
  interaction: ButtonInteraction<"cached">,
  userId: string,
): string | null {
  return (
    interaction.guild.members.cache.get(userId)?.displayName ??
    interaction.client.users.cache.get(userId)?.displayName ??
    null
  );
}

/** "" when every mod log entry was updated, otherwise a short caveat. */
function modLogSuffix(
  outcomes: readonly (ModLogRefreshOutcome | "skipped" | null)[],
): string {
  if (outcomes.length === 0) {
    return "";
  }
  if (outcomes.every((o) => o === "updated" || o === "pending")) {
    return " · mod log updated";
  }
  if (outcomes.every((o) => o === "not_configured")) {
    return "";
  }
  return " · mod log not updated";
}

/**
 * Edit reason, Delete DM and Save as template on a slash command's mod
 * action response. They act on every successful case of the action and work
 * for 15 minutes; the mod log stays the source of truth after that.
 */
export class ActionResponseButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) => {
    const token = retryIds.parse(customId);
    if (token) {
      return { path: customId, index: 0, params: { token } };
    }
    return matchResponseButtonId(customId);
  };

  private readonly now: () => number;
  private readonly retries = new ReasonFormRetryStore<RetryEntry>();

  constructor(private readonly deps: ActionResponseDeps) {
    super();
    this.now = deps.now ?? Date.now;
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const retryToken = retryIds.parse(interaction.customId);
    if (retryToken) {
      await this.recordClick("retry", () =>
        this.retryEdit(interaction, retryToken),
      );
      return;
    }

    const button = parseResponseButtonId(interaction.customId);
    if (!button) {
      throw new Error("No mod action response match", {
        cause: { customId: interaction.customId },
      });
    }

    if (button.kind === "save") {
      this.deps.metrics.recordSavePrompt("clicked");
    }

    await this.recordClick(METRIC_BUTTON[button.kind], () =>
      this.handleButton(interaction, button),
    );
  }

  private async recordClick(
    button: ActionResponseButtonKind,
    run: () => Promise<ClickOutcome>,
  ): Promise<void> {
    let outcome: ClickOutcome;
    try {
      outcome = await run();
    } catch (err) {
      this.deps.metrics.recordActionResponseButton(button, "failed");
      throw err;
    }

    if (outcome) {
      this.deps.metrics.recordActionResponseButton(button, outcome);
    }
  }

  private async handleButton(
    interaction: ButtonInteraction<"cached">,
    button: ResponseButton,
  ): Promise<ClickOutcome> {
    if (
      !(await requireMemberPermission(
        interaction,
        ANY_MOD_PERMISSION.flags,
        ANY_MOD_PERMISSION.name,
      ))
    ) {
      return "denied";
    }

    if (this.isExpired(interaction)) {
      await this.replyExpired(interaction);
      return "expired";
    }

    switch (button.kind) {
      case "edit":
        return this.editReason(
          interaction,
          button.caseIds,
          interaction.message,
        );
      case "dmDelete":
      case "dmCancel":
        return this.showDmButtons(interaction, button);
      case "dmDeleteConfirm":
        return this.deleteDms(interaction, button);
      case "save":
        return this.saveTemplate(interaction, button);
    }
  }

  /** Try again on a too-long error: reopens the form with what was typed. */
  private async retryEdit(
    interaction: ButtonInteraction<"cached">,
    token: string,
  ): Promise<ClickOutcome> {
    if (
      !(await requireMemberPermission(
        interaction,
        ANY_MOD_PERMISSION.flags,
        ANY_MOD_PERMISSION.name,
      ))
    ) {
      return "denied";
    }

    const retry = this.retries.claim(token, interaction.user.id);
    if (retry === "expired" || retry === "wrong_user") {
      await interaction.reply(retryRefusedReply(retry));
      return retry === "expired" ? "expired" : "denied";
    }

    if (this.isExpiredMessage(retry.response)) {
      this.retries.delete(token);
      await interaction.reply(
        ephemeral(EXPIRED_CLICK_MESSAGE, Color.DiscordGrey),
      );
      return "expired";
    }

    return this.editReason(interaction, retry.caseIds, retry.response, {
      token,
      values: retry.values,
    });
  }

  private isExpired(interaction: MessageInteraction): boolean {
    return interaction.message
      ? this.isExpiredMessage(interaction.message)
      : false;
  }

  private isExpiredMessage(message: PostedResponse): boolean {
    return (
      isResponseExpired(message.createdTimestamp, this.now()) ||
      showsExpiredLine(postedOf(message))
    );
  }

  private async replyExpired(
    interaction: ButtonInteraction<"cached">,
  ): Promise<void> {
    const reply = ephemeral(EXPIRED_CLICK_MESSAGE, Color.DiscordGrey);
    const expired = expireActionResponse(postedComponents(interaction));
    if (!expired) {
      await interaction.reply(reply);
      return;
    }

    await interaction.update(expired);
    await this.notePrivately(interaction, reply);
  }

  private async loadCases(
    guildId: string,
    caseIds: readonly string[],
  ): Promise<ModerationCase[]> {
    const found = await this.deps.modLogRepository.findByIds(guildId, [
      ...caseIds,
    ]);
    const byId = new Map(found.map((c) => [c.caseId, c]));
    return caseIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [c] : [];
    });
  }

  private async getEmojis(): Promise<Emojis> {
    return this.deps.emojiRepository.getEmojis(ACTION_RESPONSE_EMOJIS);
  }

  private async replyCasesGone(
    interaction: ButtonInteraction<"cached">,
  ): Promise<void> {
    await interaction.reply(
      ephemeral(
        "The cases of this action were deleted, so there's nothing to change.",
        Color.Error,
      ),
    );
  }

  /** Keeps a Save as template button only while the posted message has one and it still applies. */
  private async keepSavePrompt(
    interaction: MessageInteraction,
    cases: ModerationCase[],
  ): Promise<boolean> {
    if (!hasSavePrompt(postedComponents(interaction))) {
      return false;
    }
    return this.deps.reasonTemplateService.shouldPromptSave(
      interaction.guildId,
      cases[0]?.reason?.value ?? null,
    );
  }

  private render(interaction: MessageInteraction, body: RenderBody) {
    return interaction.message
      ? this.renderOn(interaction.message, body)
      : rebuildActionResponse([], { ...body, mode: body.mode ?? "buttons" });
  }

  /** Expired once the window has passed, whatever mode was asked for. */
  private renderOn(message: PostedResponse, body: RenderBody) {
    return rebuildActionResponse(postedOf(message), {
      ...body,
      mode: this.isExpiredMessage(message)
        ? "expired"
        : (body.mode ?? "buttons"),
    });
  }

  /** Counted only when it ends the Delete DM flow; the confirm step counts otherwise. */
  private async showDmButtons(
    interaction: ButtonInteraction<"cached">,
    button: ResponseButton,
  ): Promise<ClickOutcome> {
    const [cases, emojis] = await Promise.all([
      this.loadCases(interaction.guildId, button.caseIds),
      this.getEmojis(),
    ]);
    if (cases.length === 0) {
      await this.replyCasesGone(interaction);
      return button.kind === "dmCancel" ? "dismissed" : "ok";
    }

    const confirming = button.kind === "dmDelete" && cases.some(hasLiveDm);
    await interaction.update(
      this.render(interaction, {
        cases,
        emojis,
        savePrompt: await this.keepSavePrompt(interaction, cases),
        mode: confirming ? "confirmDeleteDm" : "buttons",
      }),
    );

    if (button.kind === "dmCancel") {
      return "dismissed";
    }

    if (confirming) {
      return null;
    }

    await this.notePrivately(
      interaction,
      ephemeral("There's no DM left to delete.", Color.DiscordGrey),
    );
    return "ok";
  }

  private async deleteDms(
    interaction: ButtonInteraction<"cached">,
    button: ResponseButton,
  ): Promise<ClickOutcome> {
    const many = button.caseIds.length > 1;
    if (many) {
      // defer: edits the mod log entry and DM of N cases
      await interaction.deferUpdate();
    }

    try {
      const [outcomes, emojis] = await Promise.all([
        this.deps.caseDmDeletionService.deleteDms(
          interaction.guildId,
          button.caseIds,
          interaction.user.id,
        ),
        this.getEmojis(),
      ]);
      const cases = outcomes.flatMap((o) =>
        o.moderationCase ? [o.moderationCase] : [],
      );
      if (cases.length === 0) {
        if (many) {
          await this.notePrivately(
            interaction,
            ephemeral("The cases of this action were deleted.", Color.Error),
          );
        } else {
          await this.replyCasesGone(interaction);
        }
        return "ok";
      }

      const deleted = outcomes.filter((o) => o.result === "deleted");
      const failed = outcomes.filter((o) => o.result === "failed");
      const message = this.render(interaction, {
        cases,
        emojis,
        savePrompt: await this.keepSavePrompt(interaction, cases),
        dmSuffix:
          deleted.length > 0 ? modLogSuffix(deleted.map((o) => o.modLog)) : "",
      });

      if (many) {
        await interaction.editReply(message);
      } else {
        await interaction.update(message);
      }

      if (failed.length > 0) {
        await this.notePrivately(
          interaction,
          ephemeral(
            `Couldn't delete ${failed.length === 1 ? "1 DM" : `${failed.length} DMs`}. Discord refused the request; try again in a moment.`,
            Color.Error,
          ),
        );
      }

      this.deps.logger.info(
        {
          guildId: interaction.guildId,
          userId: interaction.user.id,
          caseIds: button.caseIds,
          deleted: deleted.length,
          failed: failed.length,
        },
        "Deleted mod action response DMs",
      );
      return "ok";
    } catch (err) {
      if (!many) {
        throw err;
      }
      await this.reportAfterDefer(interaction, err, "Couldn't delete the DMs.");
      return "failed";
    }
  }

  private async editReason(
    interaction: ButtonInteraction<"cached">,
    requestedCaseIds: readonly string[],
    response: ResponseMessage,
    retry?: { token: string; values: FieldValues },
  ): Promise<ClickOutcome> {
    // Small indexed reads: a modal has to be the first response, so no defer.
    const [cases, formData, emojis] = await Promise.all([
      this.loadCases(interaction.guildId, requestedCaseIds),
      this.deps.reasonTemplateService.getFormData(interaction.guildId),
      this.getEmojis(),
    ]);
    if (cases.length === 0) {
      await this.replyCasesGone(interaction);
      return "ok";
    }

    const caseIds = cases.map((c) => c.caseId);
    const nameOf = (c: ModerationCase): string =>
      displayName(interaction, c.userId) ?? c.userTag;
    const liveDms = cases.filter(hasLiveDm);
    let dmTo: string | null = null;
    if (liveDms.length === 1) {
      dmTo = nameOf(liveDms[0]);
    } else if (liveDms.length > 1) {
      dmTo = `${liveDms.length} users`;
    }

    let title = buildReasonEditTitle(
      caseIds,
      cases.length === 1 ? nameOf(cases[0]) : null,
    );
    if (cases[0].actionType === ActionType.Note) {
      title = title.replace(/^Reason for /, "Edit note · ");
    }

    const modalId = buildResponseModalId(interaction.id);
    const lastExecutorId = formData.last?.executorId;
    const modal = buildReasonEditModal({
      customId: modalId,
      title,
      currentReason: cases[0].reason?.value ?? null,
      formData,
      emojis,
      lastExecutorName: lastExecutorId
        ? displayName(interaction, lastExecutorId)
        : null,
      dmTo,
    }).toJSON();
    await interaction.showModal(
      retry ? prefillModal(modal, retry.values) : modal,
    );

    let submission: ModalSubmitInteraction;
    try {
      submission = await interaction.awaitModalSubmit({
        time: formTimeoutMs(response.createdTimestamp, this.now()),
        filter: (i) =>
          i.user.id === interaction.user.id && i.customId === modalId,
      });
    } catch {
      // Rejects only when the form times out or is dismissed.
      this.deps.logger.debug(
        { caseIds, userId: interaction.user.id },
        "Mod action response reason form timed out",
      );
      return "dismissed";
    }

    if (!submission.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    return this.submitReason(submission, {
      caseIds,
      formData,
      emojis,
      response,
      retryToken: retry?.token ?? null,
    });
  }

  private async submitReason(
    submission: ModalSubmitInteraction<"cached">,
    context: {
      caseIds: string[];
      formData: ReasonFormData;
      emojis: Emojis;
      /** The response the form was opened for. */
      response: ResponseMessage;
      /** Set when the form was reopened from a Try again button. */
      retryToken: string | null;
    },
  ): Promise<ClickOutcome> {
    const { caseIds, formData, emojis, retryToken } = context;
    const parsedResult = await parseReasonFields(
      submission.fields,
      formData,
      this.deps.reasonTemplateService,
      submission.guildId,
      { metrics: this.deps.metrics, surface: "edit" },
    );
    if (parsedResult.err) {
      const token = this.retries.put(submission.user.id, {
        caseIds,
        values: captureModalValues(submission.fields),
        response: context.response,
      });
      await submission.reply(
        buildReasonFormError(
          tooLongMessage(parsedResult.val),
          emojis,
          retryIds.build(token),
        ),
      );
      return "ok";
    }

    const parsed = parsedResult.val;
    if (parsed.unresolved) {
      await submission.reply(
        buildReasonFormError(UNRESOLVED_TEMPLATE_MESSAGE, emojis),
      );
      return "ok";
    }

    if (!parsed.text) {
      await submission.reply(
        ephemeral(
          "Nothing changed: pick a template or type a reason.",
          Color.DiscordGrey,
        ),
      );
      return "ok";
    }

    if (retryToken) {
      this.retries.delete(retryToken);
    }

    // From the response itself it's updated in place; from Try again it's edited over REST.
    const onResponse = !retryToken && submission.isFromMessage();
    const deferred = !onResponse || caseIds.length > 1;
    if (!onResponse) {
      // defer: ack-only, the response is edited over REST and this error message is removed
      await submission.deferUpdate();
    } else if (caseIds.length > 1) {
      // defer: edits the mod log entry and DM of N cases
      await submission.deferUpdate();
    }

    let result: Awaited<ReturnType<typeof this.updateReasons>>;
    try {
      result = await this.updateReasons(submission, caseIds, parsed);
      if (result.updatedCases.length === 0) {
        const gone = ephemeral(
          "The cases of this action were deleted, so nothing changed.",
          Color.Error,
        );
        if (deferred) {
          await this.notePrivately(submission, gone);
        } else {
          await submission.reply(gone);
        }
        return "ok";
      }

      // The submit carries the response as it is now, unlike the click.
      const current =
        onResponse && submission.message
          ? submission.message
          : context.response;
      const message = this.renderOn(current, {
        cases: result.updatedCases,
        emojis,
        reasonNotes: this.editNotes(submission, parsed, result, emojis),
        dmOverride: this.dmOutcome(parsed, result, emojis),
        savePrompt:
          !parsed.template &&
          !parsed.saveAsTemplate &&
          result.updatedCases[0].actionType !== ActionType.Note &&
          (await this.deps.reasonTemplateService.shouldPromptSave(
            submission.guildId,
            parsed.text,
          )),
      });
      const promptAdded =
        hasSavePrompt(message.components.map((c) => c.toJSON())) &&
        !hasSavePrompt(postedOf(current));

      if (!onResponse) {
        await this.refreshFromRetry(submission, context.response, message);
      } else if (deferred) {
        await submission.editReply(message);
      } else {
        await submission.update(message);
      }

      if (promptAdded) {
        this.deps.metrics.recordSavePrompt("shown");
      }
    } catch (err) {
      if (!deferred) {
        throw err;
      }
      await this.reportAfterDefer(
        submission,
        err,
        "Couldn't finish updating the reason. Check the mod log entries.",
      );
      return "failed";
    }

    // The reason is saved from here on, so nothing below may fail the interaction.
    if (result.errorMessages.length > 0) {
      await this.notePrivately(
        submission,
        ephemeral(
          `Some cases weren't updated: ${result.errorMessages.join("; ")}`,
          Color.Error,
        ),
      );
    }

    try {
      // The response already shows the unknown shortcut note.
      await completeReasonForm(
        submission,
        {
          reasonTemplateService: this.deps.reasonTemplateService,
          emojiRepository: this.deps.emojiRepository,
          logger: this.deps.logger,
        },
        {
          guildId: submission.guildId,
          userId: submission.user.id,
          parsed: { ...parsed, unknownShortcut: null },
          emojis,
        },
      );
    } catch (err) {
      this.deps.logger.warn(
        { err, guildId: submission.guildId, caseIds },
        "Failed to finish the reason form after updating",
      );
      await this.notePrivately(
        submission,
        ephemeral("Reason updated, but a follow-up step failed.", Color.Error),
      );
    }

    this.deps.logger.info(
      {
        guildId: submission.guildId,
        userId: submission.user.id,
        caseIds,
        templateId: parsed.template?.id,
        updateDm: parsed.updateDm,
      },
      "Updated reason from mod action response",
    );
    return "ok";
  }

  /** One call per run of consecutive cases, so cases between them are never touched. */
  private async updateReasons(
    submission: ModalSubmitInteraction<"cached">,
    caseIds: string[],
    parsed: ParsedReasonFields,
  ): Promise<ReasonUpdateResult & { errorMessages: string[] }> {
    const merged: ReasonUpdateResult & { errorMessages: string[] } = {
      updatedCases: [],
      errors: [],
      dmUpdates: [],
      modLogUpdates: [],
      errorMessages: [],
    };

    for (const run of toCaseRuns(caseIds)) {
      const result = await this.deps.reasonUpdateService.updateReasons({
        guildId: submission.guildId,
        executorId: submission.user.id,
        caseRangeStr: run,
        reason: parsed.text ?? "",
        onlyEmpty: false,
        updateDm: parsed.updateDm,
      });
      if (result.err) {
        merged.errorMessages.push(result.val);
        continue;
      }
      merged.updatedCases.push(...result.val.updatedCases);
      merged.errors.push(...result.val.errors);
      merged.dmUpdates.push(...result.val.dmUpdates);
      merged.modLogUpdates.push(...result.val.modLogUpdates);
    }

    const order = new Map(caseIds.map((id, index) => [id, index]));
    merged.updatedCases.sort(
      (a, b) => (order.get(a.caseId) ?? 0) - (order.get(b.caseId) ?? 0),
    );
    return merged;
  }

  private editNotes(
    submission: ModalSubmitInteraction<"cached">,
    parsed: ParsedReasonFields,
    result: ReasonUpdateResult,
    emojis: Emojis,
  ): string[] {
    const notes: string[] = [];
    if (parsed.template) {
      notes.push(templateNote(parsed.template));
    }
    if (parsed.unknownShortcut) {
      const dmEdited = result.dmUpdates.some((u) => u.outcome === "updated");
      notes.push(unknownShortcutNote(parsed.unknownShortcut, emojis, dmEdited));
    }
    notes.push(
      editedNote(
        submission.user.id,
        new Date(this.now()),
        modLogSuffix(result.modLogUpdates.map((u) => u.outcome)),
      ),
    );
    return notes;
  }

  /** null leaves the DM line to the cases, e.g. when the DM is gone. */
  private dmOutcome(
    parsed: ParsedReasonFields,
    result: ReasonUpdateResult,
    emojis: Emojis,
  ): string | null {
    const live = result.updatedCases.filter(hasLiveDm).length;
    const withEmoji = (emoji: string, text: string): string =>
      emoji ? `${emoji} ${text}` : text;

    if (!parsed.updateDm) {
      if (live === 0) {
        return null;
      }
      return withEmoji(
        emojis.message,
        live > 1
          ? "DMs not updated: the users still see the original reason"
          : "DM not updated: the user still sees the original reason",
      );
    }

    // no_dm: the DM was deleted while the form was open.
    const attempted = result.dmUpdates.filter((u) => u.outcome !== "no_dm");
    if (attempted.length === 0) {
      return null;
    }

    const updated = attempted.filter((u) => u.outcome === "updated").length;
    const many = attempted.length > 1;
    let text: string;
    if (updated === attempted.length) {
      text = many
        ? "DMs updated with the new reason"
        : "DM updated with the new reason";
    } else if (updated === 0) {
      text = many
        ? "Couldn't update the DMs: the users still see the original reason"
        : "Couldn't update the DM: the user still sees the original reason";
    } else {
      text = `Updated ${updated} of ${attempted.length} DMs; the rest still show the original reason`;
    }
    return withEmoji(
      updated === attempted.length ? emojis.message : emojis.warning,
      text,
    );
  }

  private async saveTemplate(
    interaction: ButtonInteraction<"cached">,
    button: ResponseButton,
  ): Promise<ClickOutcome> {
    const cases = await this.loadCases(interaction.guildId, button.caseIds);
    const reason = cases[0]?.reason?.value;
    if (!reason) {
      await interaction.reply(
        ephemeral("There's no reason to save as a template.", Color.Error),
      );
      return "ok";
    }

    // Every outcome other than Ok has already been answered, or must not be.
    const saved = await showSaveTemplateModal(
      interaction,
      {
        prefillContent: reason,
        buildUpdate: async (_template, submit) => {
          const [reloaded, emojis] = await Promise.all([
            this.loadCases(interaction.guildId, button.caseIds),
            this.getEmojis(),
          ]);
          // The submit carries the response as it is now; the timer may have expired it.
          return this.renderOn(submit.message ?? interaction.message, {
            cases: reloaded.length > 0 ? reloaded : cases,
            emojis,
            savePrompt: false,
          });
        },
      },
      {
        reasonTemplateService: this.deps.reasonTemplateService,
        emojiRepository: this.deps.emojiRepository,
      },
    );
    if (saved.ok) {
      return "ok";
    }

    // Template validation and conflicts are answered outcomes, so they count as ok.
    switch (saved.val.code) {
      case "dismissed":
        return "dismissed";
      case "no_permission":
        return "denied";
      default:
        return "ok";
    }
  }

  // The reason is already saved here, so a failed refresh is only a note.
  private async refreshFromRetry(
    submission: ModalSubmitInteraction<"cached">,
    response: ResponseMessage,
    message: Parameters<ResponseMessage["edit"]>[0],
  ): Promise<void> {
    try {
      await response.edit(message);
    } catch (err) {
      this.deps.logger.warn(
        { err, guildId: submission.guildId },
        "Failed to refresh the action response after a retried edit",
      );
      await this.notePrivately(
        submission,
        ephemeral(
          "Reason updated, but this response couldn't be refreshed. The mod log entry is up to date.",
          Color.Error,
        ),
      );
    }

    await submission.deleteReply().catch((err: unknown) => {
      this.deps.logger.debug(
        { err, guildId: submission.guildId },
        "Failed to delete the retry error message",
      );
    });
  }

  /**
   * After a deferUpdate the router would answer an error by editing
   * '@original', which is this response, so errors end here instead.
   */
  private async reportAfterDefer(
    interaction: MessageInteraction,
    err: unknown,
    text: string,
  ): Promise<void> {
    this.deps.logger.error(
      { err, guildId: interaction.guildId, userId: interaction.user.id },
      "Mod action response update failed",
    );
    await this.notePrivately(interaction, ephemeral(text, Color.Error));
  }

  private async notePrivately(
    interaction: MessageInteraction,
    reply: InteractionReplyOptions,
  ): Promise<void> {
    try {
      await interaction.followUp(reply);
    } catch (err) {
      this.deps.logger.warn(
        { err, interactionId: interaction.id },
        "Failed to send mod action response note",
      );
    }
  }
}
