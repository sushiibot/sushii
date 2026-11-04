import type {
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
import { proofFileMaxBytes } from "@/features/moderation/shared/application/proofDownloads";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { CaseProofRepository } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import type { ModLogRepository } from "@/features/moderation/shared/domain/repositories/ModLogRepository";
import {
  ADD_PROOF_EMPTY_HINT,
  ADD_PROOF_FORM_PREFIX,
  buildAddProofModal,
  readAddProofFields,
} from "@/features/moderation/shared/presentation/proof/addProofModal";
import { parseAddProofCustomId } from "@/features/moderation/shared/presentation/proof/customIds";
import {
  partialProofText,
  proofErrorText,
  proofNotice,
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

    const modalCustomId = `${ADD_PROOF_FORM_PREFIX}${interaction.id}`;
    await interaction.showModal(
      buildAddProofModal({
        customId: modalCustomId,
        caseIds,
        userName: cases.length === 1 ? cases[0].userTag : null,
        existingFiles: Math.max(
          0,
          ...caseIds.map((id) => counts.get(id)?.files ?? 0),
        ),
      }),
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
      return;
    }

    if (!submission.inCachedGuild() || !submission.isFromMessage()) {
      throw new Error("Add proof form submitted outside its message", {
        cause: { customId: submission.customId },
      });
    }

    await this.handleSubmit(submission, caseIds, cases);
  }

  private async handleSubmit(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    caseIds: string[],
    cases: ModerationCase[],
  ): Promise<void> {
    const { content, files } = readAddProofFields(submission.fields);
    const origin = addProofOrigin(submission.message, cases);

    // defer: downloads and re-uploads files to the mod log
    await submission.deferUpdate();

    try {
      await this.addAndRefresh(submission, caseIds, origin, content, files);
    } catch (err) {
      // Logged here instead of the router: its reply would be a second error message.
      this.deps.logger.error(
        { err, guildId: submission.guildId, caseIds, origin },
        "Failed to add proof",
      );
      await submission
        .followUp(
          getErrorMessage(
            "Couldn't add proof",
            "Something went wrong. Try again.",
            true,
          ),
        )
        .catch((followUpErr: unknown) => {
          this.deps.logger.warn(
            { err: followUpErr, guildId: submission.guildId },
            "Failed to tell the mod adding proof failed",
          );
        });
    }
  }

  private async addAndRefresh(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    caseIds: string[],
    origin: AddProofOrigin,
    content: string | null,
    files: ReturnType<typeof readAddProofFields>["files"],
  ): Promise<void> {
    const result = await this.deps.caseProofService.add({
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

    const { proofs, skipped } = result.val;
    if (origin === "response") {
      await this.refreshResponse(submission, caseIds);
    } else if (origin === "case_view") {
      await this.refreshCaseView(submission, result.val.cases[0]);
    }

    if (skipped.length > 0) {
      await submission.followUp(
        proofNotice(
          partialProofText(
            proofs.map((p) => p.caseId),
            skipped,
          ),
          Color.Warning,
        ),
      );
    }
  }

  private responseMode(message: Message): ResponseMode {
    const posted = postedOf(message);
    if (postedStaleUrl(posted) !== undefined) {
      return "stale";
    }
    return isResponseExpired(message.createdTimestamp, this.now()) ||
      showsExpiredLine(posted)
      ? "expired"
      : "buttons";
  }

  /** Re-rendered with the new proof, so its next click doesn't see it as changed. */
  private async refreshResponse(
    submission: ModalMessageModalSubmitInteraction<"cached">,
    caseIds: string[],
  ): Promise<void> {
    const { guildId, message } = submission;
    const found = await this.deps.modLogRepository.findByIds(guildId, caseIds);
    const byId = new Map(found.map((c) => [c.caseId, c]));
    const cases = caseIds.flatMap((id) => byId.get(id) ?? []);
    const first = cases[0];
    if (!first) {
      return;
    }

    const [proofsByCase, config, emojis] = await Promise.all([
      this.deps.caseProofRepository.listByCases(guildId, [first.caseId]),
      this.deps.guildConfigRepository.findByGuildId(guildId),
      this.deps.emojiRepository.getEmojis(MODERATION_ACTION_EMOJIS),
    ]);
    const posted = postedOf(message);
    const mode = this.responseMode(message);
    const modLogUrl = modLogEntryUrl(
      guildId,
      config.loggingSettings.modLogChannel,
      first.msgId,
    );

    await submission.editReply(
      rebuildActionResponse(posted, {
        cases,
        proofs: proofsByCase.get(first.caseId) ?? [],
        emojis,
        savePrompt: hasSavePrompt(posted),
        modLogUrl:
          mode === "stale" ? (postedStaleUrl(posted) ?? modLogUrl) : modLogUrl,
        mode,
      }),
    );
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
