import type { InteractionReplyOptions } from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

import { formatCaseRefs } from "@/features/moderation/actions/presentation/views/ModerationActionView";
import type {
  AddProofError,
  CaseSkip,
  CaseSkipReason,
} from "@/features/moderation/cases/application/CaseProofService";
import Color from "@/utils/colors";
import { quoteMarkdownString } from "@/utils/markdown";

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
  failed: "Something went wrong there. Try again.",
};

export interface ProofErrorContext {
  /** What the mod fills in on this surface, e.g. "Fill in Details, add a file, or both." */
  emptyHint: string;
  /** What the mod typed, quoted back since nothing was saved. */
  typed?: string | null;
  /** The largest file sushii re-uploads here. */
  maxFileBytes: number;
}

function megabytes(bytes: number): string {
  return `${number.format(Math.floor(bytes / (1024 * 1024)))} MB`;
}

function refusalText(error: AddProofError, context: ProofErrorContext) {
  if (typeof error !== "string") {
    const reasons = [...new Set(error.skipped.map((s) => SKIP_TEXT[s.reason]))];
    return reasons.join("\n");
  }
  switch (error) {
    case "empty":
      return `**Add some proof first**\n-# ${context.emptyHint}`;
    case "content_too_long":
      return `Proof text can be up to ${number.format(PROOF_CONTENT_MAX_LENGTH)} characters.`;
    case "too_many_files":
      return `A case holds up to ${PROOF_FILES_PER_CASE_MAX} proof files. Add fewer files.`;
    case "file_too_large":
      return `A file is too large for sushii to upload to the mod log. The limit here is ${megabytes(context.maxFileBytes)}.`;
    case "cases_not_found":
      return "This case was deleted, so there's nothing to add proof to.";
  }
}

/** Short, searchable text for each expected refusal, with the typed text quoted back. */
export function proofErrorText(
  error: AddProofError,
  context: ProofErrorContext,
): string {
  const text = refusalText(error, context);
  const typed = context.typed?.trim();
  if (!typed || error === "empty") {
    return text;
  }
  return `${text}\n-# Nothing was saved. What you typed:\n${quoteMarkdownString(typed)}`;
}

/** For proof that reached some cases of an action but not all of them. */
export function partialProofText(
  added: readonly string[],
  skipped: readonly CaseSkip[],
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
