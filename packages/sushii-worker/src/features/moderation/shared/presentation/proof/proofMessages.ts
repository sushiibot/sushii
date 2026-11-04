import type { InteractionReplyOptions } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  escapeMarkdown,
} from "discord.js";

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

/** Also covers a deleted entry or an old case that never got one, not only a missing channel. */
export const NO_MOD_LOG_ENTRY_FOR_FILES_TEXT =
  "Proof files are stored on the case's mod log entry, and this case doesn't have one. If the server has no mod log channel, set one in `/settings`.";

export const RETRY_LATER_TEXT =
  "The mod log entry is still being posted. Try again in a few seconds.";

const SKIP_TEXT: Record<CaseSkipReason, string> = {
  retry_later: RETRY_LATER_TEXT,
  no_mod_log_for_files: NO_MOD_LOG_ENTRY_FOR_FILES_TEXT,
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

/** The mod's text quoted back when nothing was saved, so it isn't lost. */
export function typedBackText(typed: string | null | undefined): string {
  const text = typed?.trim();
  return text
    ? `\n-# Nothing was saved. What you typed:\n${quoteMarkdownString(
        escapeMarkdown(text, {
          maskedLink: true,
          heading: true,
          bulletedList: true,
          numberedList: true,
        }),
      )}`
    : "";
}

/** Short, searchable text for each expected refusal, with the typed text quoted back. */
export function proofErrorText(
  error: AddProofError,
  context: ProofErrorContext,
): string {
  const text = refusalText(error, context);
  return error === "empty" ? text : text + typedBackText(context.typed);
}

/** Retrying from the button would add the proof again to the cases that got it. */
function skippedCaseLine(skip: CaseSkip): string | null {
  const ref = `Case #${skip.caseId}`;
  const again = `Add it again from ${ref}'s mod log entry or case view.`;
  switch (skip.reason) {
    case "retry_later":
      return `-# ${ref}: its mod log entry is still being posted. ${again}`;
    case "failed":
      return `-# ${ref}: something went wrong. ${again}`;
    case "no_mod_log_for_files":
      return null;
  }
}

/** For proof that reached some cases of an action but not all of them. */
export function partialProofText(
  added: readonly string[],
  skipped: readonly CaseSkip[],
): string {
  const lines = skipped.flatMap((s) => skippedCaseLine(s) ?? []);
  if (skipped.some((s) => s.reason === "no_mod_log_for_files")) {
    lines.push(`-# ${NO_MOD_LOG_ENTRY_FOR_FILES_TEXT}`);
  }
  return [
    `Proof added: ${formatCaseRefs(added)}. Not added: ${formatCaseRefs(skipped.map((s) => s.caseId))}.`,
    ...lines,
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
