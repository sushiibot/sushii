import type {
  APIComponentInContainer,
  APIMessageTopLevelComponent,
  ButtonInteraction,
  Message,
  ModalMessageModalSubmitInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import { MessageFlags } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import { modLogEntryUrl } from "@/features/moderation/actions/presentation/response/modLogEntryUrl";
import {
  MODERATION_ACTION_EMOJIS,
  type ResponseMode,
  hasSavePrompt,
  isResponseExpired,
  postedProofText,
  postedStaleUrl,
  rebuildActionResponse,
  showsExpiredLine,
} from "@/features/moderation/actions/presentation/views/ModerationActionView";
import type { CaseProofService } from "@/features/moderation/cases/application/CaseProofService";
import { HISTORY_ACTION_EMOJIS } from "@/features/moderation/cases/presentation/views/HistoryView";
import {
  type CaseViewSources,
  isCaseViewMessage,
  loadCaseViewMessages,
} from "@/features/moderation/mod-view/presentation/views/CaseView";
import { viewerAccessFromMember } from "@/features/moderation/proof-suggestions/application/viewerAccess";
import type { ProofSuggestion } from "@/features/moderation/proof-suggestions/domain/ProofSuggestion";
import type {
  SuggestionAddResult,
  SuggestionFlow,
} from "@/features/moderation/proof-suggestions/presentation/SuggestionFlow";
import { postedAddAllFingerprint } from "@/features/moderation/proof-suggestions/presentation/customIds";
import {
  type OfferedSuggestions,
  cachedViewerAccess,
  suggestedOptions,
} from "@/features/moderation/proof-suggestions/presentation/modalSuggestions";
import {
  buildResponseSuggestionBlock,
  buildSuggestionAddResult,
} from "@/features/moderation/proof-suggestions/presentation/views";
import { proofFileMaxBytes } from "@/features/moderation/shared/application/proofDownloads";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import {
  ADD_PROOF_EMPTY_HINT,
  ADD_PROOF_FORM_PREFIX,
  SUGGESTED_OPTIONS_MAX,
  buildAddProofModal,
  readAddProofFields,
} from "@/features/moderation/shared/presentation/proof/addProofModal";
import { parseAddProofCustomId } from "@/features/moderation/shared/presentation/proof/customIds";
import {
  PROOF_INTRO_ID,
  type PromptOffer,
} from "@/features/moderation/shared/presentation/proof/proofIntroOffer";
import {
  partialProofText,
  proofErrorText,
  proofNotice,
  typedBackText,
} from "@/features/moderation/shared/presentation/proof/proofMessages";
import { getErrorMessage } from "@/interactions/responses/error";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { ButtonHandler } from "@/shared/presentation/handlers";
import {
  ANY_MOD_PERMISSION,
  requireMemberPermission,
} from "@/shared/presentation/requireMemberPermission";
import Color from "@/utils/colors";

const MODAL_TIMEOUT_MS = 10 * 60 * 1000;

export interface AddProofDeps {
  modLogRepository: Pick<ModLogRepository, "findByIds">;
  caseProofRepository: Pick<
    CaseProofRepository,
    "countsByCases" | "listByCases" | "listByCase"
  >;
  guildConfigRepository: Pick<GuildConfigRepository, "findByGuildId">;
  caseProofService: Pick<CaseProofService, "add">;
  emojiRepository: Pick<BotEmojiRepository, "getEmojis">;
  promptOffer: PromptOffer;
  /** Lists suggested proof in the form; without it the form is unchanged. */
  suggestionFlow?: SuggestionFlow;
  logger: Logger;
  now?: () => number;
}

/**
 * - `mod_log`: the case's entry, already edited by the hosting
 * - `response`: a slash command's action response
 * - `case_view`: the private case view from History
 */
export type AddProofOrigin = "mod_log" | "response" | "case_view" | "other";

interface PostedMessage {
  id: string;
  components: readonly { toJSON(): unknown }[];
}

function postedOf(message: Pick<PostedMessage, "components">) {
  return message.components.map((c) =>
    c.toJSON(),
  ) as APIMessageTopLevelComponent[];
}

function responseMode(
  message: Pick<Message, "createdTimestamp"> & PostedMessage,
  now: number,
): ResponseMode {
  const posted = postedOf(message);
  if (postedStaleUrl(posted) !== undefined) {
    return "stale";
  }
  return isResponseExpired(message.createdTimestamp, now) ||
    showsExpiredLine(posted)
    ? "expired"
    : "buttons";
}

export type ResponseRefreshDeps = Pick<
  AddProofDeps,
  | "modLogRepository"
  | "caseProofRepository"
  | "guildConfigRepository"
  | "emojiRepository"
>;

/** The action response re-rendered with its cases' current proof; null when the cases are gone. */
export async function rebuildResponseWithProof(
  deps: ResponseRefreshDeps,
  guildId: string,
  message: Pick<Message, "createdTimestamp"> & PostedMessage,
  caseIds: string[],
  now: number,
  suggestions?: readonly APIComponentInContainer[],
): Promise<ReturnType<typeof rebuildActionResponse> | null> {
  const found = await deps.modLogRepository.findByIds(guildId, caseIds);
  const byId = new Map(found.map((c) => [c.caseId, c]));
  const cases = caseIds.flatMap((id) => byId.get(id) ?? []);
  const first = cases[0];
  if (!first) {
    return null;
  }

  const [proofsByCase, config, emojis] = await Promise.all([
    deps.caseProofRepository.listByCases(guildId, [first.caseId]),
    deps.guildConfigRepository.findByGuildId(guildId),
    deps.emojiRepository.getEmojis(MODERATION_ACTION_EMOJIS),
  ]);
  const posted = postedOf(message);
  const mode = responseMode(message, now);
  const modLogUrl = modLogEntryUrl(
    guildId,
    config.loggingSettings.modLogChannel,
    first.msgId,
  );

  return rebuildActionResponse(posted, {
    cases,
    proofs: proofsByCase.get(first.caseId) ?? [],
    suggestions,
    emojis,
    savePrompt: hasSavePrompt(posted),
    modLogUrl:
      mode === "stale" ? (postedStaleUrl(posted) ?? modLogUrl) : modLogUrl,
    mode,
  });
}

/** The mod log check comes first: it's the only one tied to stored data. */
export function addProofOrigin(
  message: PostedMessage,
  cases: readonly ModerationCase[],
): AddProofOrigin {
  if (cases.some((c) => c.msgId === message.id)) {
    return "mod_log";
  }
  const posted = postedOf(message);
  if (postedProofText(posted) !== null) {
    return "response";
  }
  if (isCaseViewMessage(posted)) {
    return "case_view";
  }
  return "other";
}

/**
 * Add proof on the action response, the mod log entry and the case view.
 * Opens a form with text and files, then adds them to every case on the
 * button and refreshes the message it was clicked on.
 */
export class AddProofButtonHandler extends ButtonHandler {
  customIDMatch = (customId: string) =>
    parseAddProofCustomId(customId)
      ? { path: customId, index: 0, params: {} }
      : false;

  private readonly now: () => number;

  constructor(private readonly deps: AddProofDeps) {
    super();
    this.now = deps.now ?? Date.now;
  }

  async handleInteraction(interaction: ButtonInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Not a guild interaction");
    }

    const caseIds = parseAddProofCustomId(interaction.customId);
    if (!caseIds) {
      throw new Error("No add proof match", {
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

    // Small indexed reads: a modal has to be the first response, so no defer.
    const [cases, counts] = await Promise.all([
      this.deps.modLogRepository.findByIds(interaction.guildId, caseIds),
      this.deps.caseProofRepository.countsByCases(interaction.guildId, caseIds),
    ]);
    if (cases.length === 0) {
      await interaction.reply(
        proofNotice(
          proofErrorText("cases_not_found", {
            emptyHint: ADD_PROOF_EMPTY_HINT,
            maxFileBytes: proofFileMaxBytes(interaction.attachmentSizeLimit),
          }),
        ),
      );
      return;
    }

    const offered = await this.offeredSuggestions(interaction, cases);
    // The fingerprint pins what was listed, so a submit saves exactly that.
    const modalCustomId = offered
      ? `${ADD_PROOF_FORM_PREFIX}${interaction.id}/${offered.fingerprint}`
      : `${ADD_PROOF_FORM_PREFIX}${interaction.id}`;
    await interaction.showModal(
      buildAddProofModal({
        customId: modalCustomId,
        caseIds,
        userName: cases.length === 1 ? cases[0].userTag : null,
        existingFiles: Math.max(
          0,
          ...caseIds.map((id) => counts.get(id)?.files ?? 0),
        ),
        suggested: offered ? suggestedOptions(offered) : undefined,
      }),
    );
    if (offered) {
      this.deps.suggestionFlow?.metrics.recordShown("modal", {
        userId: interaction.user.id,
        guildId: interaction.guildId,
      });
    }

    let submission: ModalSubmitInteraction;
    try {
      submission = await interaction.awaitModalSubmit({
        time: MODAL_TIMEOUT_MS,
        filter: (i) =>
          i.user.id === interaction.user.id && i.customId === modalCustomId,
      });
    } catch {
      // Rejects only when the form times out or is dismissed.
      return;
    }

    if (!submission.inCachedGuild() || !submission.isFromMessage()) {
      throw new Error("Add proof form submitted outside its message", {
        cause: { customId: submission.customId },
      });
    }

    await this.handleSubmit(submission, caseIds, cases, offered);
  }

  /**
   * Suggestions for a single case without proof. DB-only, since the modal
   * must be the first response; uncached private threads are left out.
   */
  private async offeredSuggestions(
    interaction: ButtonInteraction<"cached">,
    cases: ModerationCase[],
  ): Promise<OfferedSuggestions | null> {
    const flow = this.deps.suggestionFlow;
    const moderationCase = cases.length === 1 ? cases[0] : null;
    if (!flow || !moderationCase || !flow.eligible(moderationCase)) {
      return null;
    }

    try {
      const access = cachedViewerAccess(interaction.member, this.deps.logger);
      const suggestions = (await flow.compute(moderationCase, access)).slice(
        0,
        SUGGESTED_OPTIONS_MAX,
      );
      if (suggestions.length === 0) {
        return null;
      }
      return {
        moderationCase,
        suggestions,
        fingerprint: flow.fingerprint(suggestions),
        channelName: (id) => access.channelName(id),
      };
    } catch (err) {
      // The form still opens, just without suggestions.
      this.deps.logger.warn(
        { err, guildId: interaction.guildId, caseId: moderationCase.caseId },
        "Failed to find suggested proof for the Add proof form",
      );
      return null;
    }
  }

  /** The ticked suggestions, or null when the set changed since the form opened. */
  private async pickedSuggestions(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    offered: OfferedSuggestions,
    values: readonly string[],
  ): Promise<ProofSuggestion[] | null> {
    const flow = this.deps.suggestionFlow;
    if (!flow) {
      return null;
    }
    const access = cachedViewerAccess(submission.member, this.deps.logger);
    const current = (await flow.compute(offered.moderationCase, access)).slice(
      0,
      SUGGESTED_OPTIONS_MAX,
    );
    if (flow.fingerprint(current) !== offered.fingerprint) {
      return null;
    }
    const picked: ProofSuggestion[] = [];
    for (const value of new Set(values)) {
      const suggestion = /^\d{1,2}$/.test(value)
        ? current[Number(value)]
        : undefined;
      if (!suggestion) {
        return null;
      }
      picked.push(suggestion);
    }
    return picked;
  }

  private async handleSubmit(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    caseIds: string[],
    cases: ModerationCase[],
    offered: OfferedSuggestions | null,
  ): Promise<void> {
    const { content, files, suggested } = readAddProofFields(submission.fields);
    const origin = addProofOrigin(submission.message, cases);
    const flow = this.deps.suggestionFlow;

    // defer: downloads and re-uploads files to the mod log, and resolves suggested message links
    await submission.deferUpdate();

    let picked: ProofSuggestion[] = [];
    if (offered && flow && suggested.length > 0) {
      const current = await this.pickedSuggestions(
        submission,
        offered,
        suggested,
      );
      if (!current) {
        flow.metrics.recordAdded(
          "modal",
          "changed",
          { userId: submission.user.id, guildId: submission.guildId },
          0,
        );
        await submission.followUp(
          proofNotice(
            `The suggestions changed. Open Add proof again to see the current ones.${typedBackText(content)}`,
            Color.Warning,
          ),
        );
        return;
      }
      picked = current;
    }

    // Ticked suggestions alone are a complete submit.
    if (picked.length > 0 && !content && files.length === 0) {
      const added = await this.addPicked(submission, offered, picked, origin);
      if (added?.kind === "added") {
        await this.refreshOrigin(
          submission,
          caseIds,
          origin,
          cases[0],
          offered?.fingerprint ?? null,
        );
      }
      if (added) {
        await this.notePrivately(submission, {
          ...buildSuggestionAddResult(added),
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
      }
      await this.deps.promptOffer.offer(submission, PROOF_INTRO_ID);
      return;
    }

    let result: Awaited<ReturnType<AddProofDeps["caseProofService"]["add"]>>;
    try {
      result = await this.deps.caseProofService.add({
        guildId: submission.guildId,
        caseIds,
        authorId: submission.user.id,
        kind: "button",
        content,
        files,
        uploadLimit: submission.attachmentSizeLimit,
        exceptMessageId:
          origin === "response" ? submission.message.id : undefined,
      });
    } catch (err) {
      // Logged here instead of the router: its reply would be a second error message.
      this.deps.logger.error(
        { err, guildId: submission.guildId, caseIds, origin },
        "Failed to add proof",
      );
      await this.notePrivately(
        submission,
        getErrorMessage(
          "Couldn't add proof",
          `Something went wrong. Try again.${typedBackText(content)}`,
          true,
        ),
      );
      return;
    }

    if (result.err) {
      await submission.followUp(
        proofNotice(
          proofErrorText(result.val, {
            emptyHint: ADD_PROOF_EMPTY_HINT,
            typed: content,
            maxFileBytes: proofFileMaxBytes(submission.attachmentSizeLimit),
          }),
        ),
      );
      return;
    }

    const { proofs, skipped, cases: added } = result.val;
    const suggestionsAdded =
      picked.length > 0
        ? await this.addPicked(submission, offered, picked, origin)
        : null;
    await this.refreshOrigin(
      submission,
      caseIds,
      origin,
      added[0],
      offered?.fingerprint ?? null,
    );
    if (suggestionsAdded) {
      await this.notePrivately(submission, {
        ...buildSuggestionAddResult(suggestionsAdded),
        flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      });
    }

    if (skipped.length > 0) {
      await this.notePrivately(
        submission,
        proofNotice(
          partialProofText(
            proofs.map((p) => p.caseId),
            skipped,
          ),
          Color.Warning,
        ),
      );
    }

    await this.deps.promptOffer.offer(submission, PROOF_INTRO_ID);
  }

  /** null when it threw; that's logged and reported here. */
  private async addPicked(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    offered: OfferedSuggestions | null,
    picked: ProofSuggestion[],
    origin: AddProofOrigin,
  ): Promise<SuggestionAddResult | null> {
    const flow = this.deps.suggestionFlow;
    if (!flow || !offered) {
      return null;
    }
    try {
      return await flow.add({
        moderationCase: offered.moderationCase,
        chosen: picked,
        authorId: submission.user.id,
        surface: "modal",
        exceptMessageId:
          origin === "response" ? submission.message.id : undefined,
      });
    } catch (err) {
      this.deps.logger.error(
        {
          err,
          guildId: submission.guildId,
          caseId: offered.moderationCase.caseId,
        },
        "Failed to add suggested proof",
      );
      await this.notePrivately(
        submission,
        getErrorMessage(
          "Couldn't add suggestions",
          "Something went wrong. Try again.",
          true,
        ),
      );
      return null;
    }
  }

  private async refreshOrigin(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    caseIds: string[],
    origin: AddProofOrigin,
    moderationCase: ModerationCase | undefined,
    offeredFingerprint: string | null,
  ): Promise<void> {
    try {
      if (origin === "response") {
        await this.refreshResponse(
          submission,
          caseIds,
          moderationCase,
          offeredFingerprint,
        );
      } else if (origin === "case_view" && moderationCase) {
        await this.refreshCaseView(submission, moderationCase);
      }
    } catch (err) {
      // The proof is saved; the mod log entry shows it even if this message doesn't.
      this.deps.logger.warn(
        { err, guildId: submission.guildId, caseIds, origin },
        "Failed to refresh the message proof was added from",
      );
    }
  }

  /** Best effort: the add already happened or was already reported. */
  private async notePrivately(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    message: Parameters<ModalMessageModalSubmitInteraction["followUp"]>[0],
  ): Promise<void> {
    try {
      await submission.followUp(message);
    } catch (err) {
      this.deps.logger.warn(
        { err, guildId: submission.guildId },
        "Failed to send an Add proof note",
      );
    }
  }

  /** Re-rendered with the new proof, so its next click doesn't see it as changed. */
  private async refreshResponse(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    caseIds: string[],
    moderationCase: ModerationCase | undefined,
    offeredFingerprint: string | null,
  ): Promise<void> {
    const flow = this.deps.suggestionFlow;
    let block: APIComponentInContainer[] = [];
    const posted = postedAddAllFingerprint(
      JSON.stringify(submission.message.components),
    );
    // Only the view the public block was built from may rebuild it; another mod's submit drops it.
    if (
      flow &&
      moderationCase &&
      caseIds.length === 1 &&
      posted !== null &&
      posted === offeredFingerprint
    ) {
      const suggestions = await flow.compute(
        moderationCase,
        viewerAccessFromMember(submission.member, this.deps.logger),
      );
      if (suggestions.length > 0) {
        block = buildResponseSuggestionBlock({
          caseId: moderationCase.caseId,
          fingerprint: flow.fingerprint(suggestions),
          suggestions,
          targetName: moderationCase.userTag,
          actionType: moderationCase.actionType,
        });
      }
    }
    const rebuilt = await rebuildResponseWithProof(
      this.deps,
      submission.guildId,
      submission.message,
      caseIds,
      this.now(),
      block,
    );
    if (rebuilt) {
      await submission.editReply(rebuilt);
    }
  }

  private async refreshCaseView(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    moderationCase: ModerationCase,
  ): Promise<void> {
    const sources: CaseViewSources = {
      caseProofRepository: this.deps.caseProofRepository,
      guildConfigRepository: this.deps.guildConfigRepository,
    };
    const emojis = await this.deps.emojiRepository.getEmojis(
      HISTORY_ACTION_EMOJIS,
    );
    const [first] = await loadCaseViewMessages(
      moderationCase,
      emojis,
      sources,
      {
        firstOnly: true,
      },
    );

    // An edit can't set Ephemeral; the message keeps its own flags.
    await submission.editReply({
      ...first,
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
