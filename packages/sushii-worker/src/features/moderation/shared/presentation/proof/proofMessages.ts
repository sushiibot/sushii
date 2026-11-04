import type { InteractionReplyOptions } from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

import { formatCaseRefs } from "@/features/moderation/actions/presentation/views/ModerationActionView";
import type {
  AddProofError,
  CaseSkipReason,
} from "@/features/moderation/cases/application/CaseProofService";
import Color from "@/utils/colors";

import {
  PROOF_CONTENT_MAX_LENGTH,
  PROOF_FILES_PER_CASE_MAX,
} from "../../domain/entities/CaseProof";

const number = new Intl.NumberFormat("en-US");

export const NO_MOD_LOG_FOR_FILES_TEXT =
  "Proof files are stored on the mod log entry, and this server has no mod log channel. Set one in `/settings`.";

export const RETRY_LATER_TEXT =
  "The mod log entry is still being posted. Try again in a few seconds.";

const SKIP_TEXT: Record<CaseSkipReason, string> = {
  retry_later: RETRY_LATER_TEXT,
  no_mod_log_for_files: NO_MOD_LOG_FOR_FILES_TEXT,
};

/** Short, searchable text for each expected refusal. */
export function proofErrorText(
  error: AddProofError,
  /** What the mod fills in on this surface, e.g. "Fill in Details, add a file, or both." */
  emptyHint: string,
): string {
  switch (error) {
    case "empty":
      return `**Add some proof first**\n-# ${emptyHint}`;
    case "content_too_long":
      return `Proof text can be up to ${number.format(PROOF_CONTENT_MAX_LENGTH)} characters.`;
    case "too_many_files":
      return `A case holds up to ${PROOF_FILES_PER_CASE_MAX} proof files. Add fewer files.`;
    case "file_too_large":
      return "A file is too large for sushii to upload to the mod log.";
    case "cases_not_found":
      return "This case was deleted, so there's nothing to add proof to.";
    case "retry_later":
    case "no_mod_log_for_files":
      return SKIP_TEXT[error];
  }
}

/** For proof that reached some cases of an action but not all of them. */
export function partialProofText(
  added: readonly string[],
  skipped: readonly { caseId: string; reason: CaseSkipReason }[],
): string {
  const reasons = [...new Set(skipped.map((s) => SKIP_TEXT[s.reason]))];
  return [
    `Proof added: ${formatCaseRefs(added)}. Not added: ${formatCaseRefs(skipped.map((s) => s.caseId))}.`,
    ...reasons.map((r) => `-# ${r}`),
  ].join("\n");
}

export function proofNotice(
  text: string,
  accent: number = Color.Error,
): InteractionReplyOptions & { flags: number } {
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
