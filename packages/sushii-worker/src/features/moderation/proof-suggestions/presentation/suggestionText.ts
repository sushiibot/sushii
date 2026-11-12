import { escapeMarkdown } from "discord.js";

import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

import type {
  ProofSuggestion,
  SuggestionKind,
} from "../domain/ProofSuggestion";
import type {
  ResolvedSuggestionLinks,
  SkipReason,
} from "../domain/proofContent";
import { MAX_LINKS_PER_PROOF } from "../domain/proofContent";
import { relativeTimeRange } from "../domain/relativeTime";

/** Actions whose cases get suggested proof; reversals and lookups don't need any. */
export const SUGGESTION_ACTIONS: ReadonlySet<ActionType> = new Set([
  ActionType.Ban,
  ActionType.TempBan,
  ActionType.Softban,
  ActionType.Kick,
  ActionType.Timeout,
  ActionType.Warn,
  ActionType.Note,
]);

const ACTION_NOUNS: Partial<Record<ActionType, string>> = {
  [ActionType.Ban]: "ban",
  [ActionType.TempBan]: "temp ban",
  [ActionType.Softban]: "softban",
  [ActionType.Kick]: "kick",
  [ActionType.Timeout]: "timeout",
  [ActionType.Warn]: "warning",
  [ActionType.Note]: "note",
};

export const KIND_EMOJI: Record<SuggestionKind, string> = {
  automod: "🤖",
  deleted: "🗑️",
  recent: "💬",
};

const RULE_NAME_MAX_LENGTH = 60;
const OPTION_TEXT_MAX_LENGTH = 100;

export function actionNoun(actionType: ActionType): string {
  return ACTION_NOUNS[actionType] ?? "action";
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

function compareIds(a: string | undefined, b: string | undefined): number {
  if (a === b) {
    return 0;
  }
  if (a === undefined || b === undefined) {
    return a === undefined ? -1 : 1;
  }
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : 1;
}

/** Indexes in selects and checkboxes point into this order, so every surface sorts the same way. */
export function orderSuggestions(
  suggestions: readonly ProofSuggestion[],
): ProofSuggestion[] {
  return [...suggestions].sort(
    (a, b) =>
      b.lastAt.getTime() - a.lastAt.getTime() ||
      a.kind.localeCompare(b.kind) ||
      compareIds(a.messageIds[0], b.messageIds[0]),
  );
}

/** AutoMod alerts and fully deleted runs are strong matches; still-visible messages aren't. */
export function preselected(suggestion: ProofSuggestion): boolean {
  return suggestion.kind !== "recent";
}

export function countLabel(suggestion: ProofSuggestion): string {
  if (suggestion.kind === "automod") {
    return "AutoMod alert";
  }
  const shown = suggestion.messageIds.length;
  const word = suggestion.kind === "deleted" ? "deleted message" : "message";
  if (suggestion.totalInWindow > shown) {
    return `Last ${shown} of ${suggestion.totalInWindow} ${word}s`;
  }
  return plural(shown, word);
}

function ruleName(suggestion: ProofSuggestion): string {
  return truncate(suggestion.ruleName ?? "AutoMod", RULE_NAME_MAX_LENGTH);
}

function unix(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function timeRange(suggestion: ProofSuggestion): string {
  const first = unix(suggestion.firstAt);
  const last = unix(suggestion.lastAt);
  return first === last ? `<t:${last}:R>` : `<t:${first}:R> – <t:${last}:R>`;
}

function pickerTimeRange(suggestion: ProofSuggestion): string {
  const first = unix(suggestion.firstAt);
  const last = unix(suggestion.lastAt);
  // `:t` shows minutes only, so a range inside one minute would print the same time twice.
  return Math.floor(first / 60) === Math.floor(last / 60)
    ? `<t:${last}:t>`
    : `<t:${first}:t>–<t:${last}:t>`;
}

function visibility(suggestion: ProofSuggestion): string {
  const deleted = suggestion.deletedCount ?? 0;
  return deleted > 0 ? `${deleted} deleted` : "still visible";
}

/** One quoted line for the public response: counts, channel and times only, never content. */
export function responseLine(suggestion: ProofSuggestion): string {
  const emoji = KIND_EMOJI[suggestion.kind];
  if (suggestion.kind === "automod") {
    return `> ${emoji} **AutoMod alert** · ${escapeMarkdown(ruleName(suggestion))} · ${timeRange(suggestion)}`;
  }
  const where = `**${countLabel(suggestion)}** in <#${suggestion.channelId}>`;
  if (suggestion.kind === "deleted") {
    return `> ${emoji} ${where} · ${timeRange(suggestion)}`;
  }
  return `> ${emoji} ${where} · ${visibility(suggestion)} · ${timeRange(suggestion)}`;
}

/** Message log links are deduped per post, so runs with deleted messages may save fewer. */
export function linksEstimate(suggestions: readonly ProofSuggestion[]): {
  count: number;
  exact: boolean;
} {
  let count = 0;
  let exact = true;
  for (const s of suggestions) {
    if (s.kind === "automod") {
      count += 1;
      continue;
    }
    count += Math.min(s.messageIds.length, MAX_LINKS_PER_PROOF);
    if (s.kind === "deleted" || (s.deletedCount ?? 0) > 0) {
      exact = false;
    }
  }
  return { count, exact };
}

export function responseBlockText(input: {
  suggestions: readonly ProofSuggestion[];
  targetName: string;
  actionType: ActionType;
}): string {
  const { suggestions } = input;
  const { count, exact } = linksEstimate(suggestions);
  const links = `${exact ? "" : "up to "}${plural(count, "link")}`;
  return [
    `**💡 ${plural(suggestions.length, "suggestion")}** · from ${escapeMarkdown(input.targetName)}'s messages before the ${actionNoun(input.actionType)}`,
    ...suggestions.map(responseLine),
    `-# Adds ${links}. Review shows previews only you can see.`,
  ].join("\n");
}

/** Heading and what the suggestion saves, for the ephemeral picker. */
export function pickerSectionText(suggestion: ProofSuggestion): string {
  const emoji = KIND_EMOJI[suggestion.kind];
  if (suggestion.kind === "automod") {
    const blocked = suggestion.blockedInChannelId
      ? ` · blocked in <#${suggestion.blockedInChannelId}>`
      : "";
    return `**${emoji} AutoMod alert** · ${escapeMarkdown(ruleName(suggestion))}${blocked} · ${pickerTimeRange(suggestion)}\n-# Saves the alert link in <#${suggestion.channelId}>`;
  }

  const one = suggestion.messageIds.length === 1;
  const heading = `**${emoji} ${countLabel(suggestion)}** in <#${suggestion.channelId}> · ${pickerTimeRange(suggestion)}`;
  if (suggestion.kind === "deleted") {
    return `${heading}\n-# ${one ? "Saves its message log link" : "Saves their message log links"}`;
  }
  if ((suggestion.deletedCount ?? 0) > 0) {
    return `${heading} · ${visibility(suggestion)}\n-# Saves message links, and message log links for the deleted ones`;
  }
  return `${heading} · still visible\n-# ${one ? "Saves its message link" : "Saves their message links"}`;
}

export function previewDescription(
  suggestion: ProofSuggestion,
  targetName: string,
  channelName: string | null,
): string {
  if (suggestion.kind === "automod") {
    return "Preview of the AutoMod alert";
  }
  const where = channelName ? ` in #${channelName}` : "";
  return truncate(
    `Preview of ${targetName}'s messages${where}`,
    OPTION_TEXT_MAX_LENGTH,
  );
}

/** Plain text for a select option label. */
export function selectLabel(
  suggestion: ProofSuggestion,
  channelName: string | null,
): string {
  if (suggestion.kind === "automod") {
    return truncate(
      `AutoMod alert · ${ruleName(suggestion)}`,
      OPTION_TEXT_MAX_LENGTH,
    );
  }
  const where = channelName ? ` · #${channelName}` : "";
  return truncate(`${countLabel(suggestion)}${where}`, OPTION_TEXT_MAX_LENGTH);
}

/** Modal checkbox label: text only, ≤ 100 characters. */
export function checkboxLabel(
  suggestion: ProofSuggestion,
  channelName: string | null,
  actionTime: Date,
): string {
  const emoji = KIND_EMOJI[suggestion.kind];
  const when = relativeTimeRange(
    suggestion.firstAt,
    suggestion.lastAt,
    actionTime,
  );
  if (suggestion.kind === "automod") {
    return truncate(
      `${emoji} AutoMod alert · ${ruleName(suggestion)} · ${when}`,
      OPTION_TEXT_MAX_LENGTH,
    );
  }
  const parts = [`${emoji} ${countLabel(suggestion)}`];
  if (channelName) {
    parts.push(`#${channelName}`);
  }
  if (suggestion.kind === "recent") {
    parts.push(visibility(suggestion));
  }
  parts.push(when);
  return truncate(parts.join(" · "), OPTION_TEXT_MAX_LENGTH);
}

/** The engine escapes snippets for markdown; modal descriptions show text as-is. */
export function plainSnippet(snippet: string): string {
  return truncate(
    snippet.replace(/\\([\\*_~`|>#\-[\]()<:])/g, "$1"),
    OPTION_TEXT_MAX_LENGTH,
  );
}

export interface AddedSummary {
  caseId: string;
  /** Suggestions that produced a proof row. */
  added: number;
  alreadyAdded?: number;
  links: number;
  pending: number;
  skipped: Record<SkipReason, number>;
  shown: "all" | "pending" | "not_shown" | null;
}

export function summarize(
  caseId: string,
  resolved: readonly ResolvedSuggestionLinks[],
  added: number,
  shown: AddedSummary["shown"],
): AddedSummary {
  const skipped: Record<SkipReason, number> = {
    deleted_not_logged: 0,
    unchecked: 0,
  };
  for (const r of resolved) {
    for (const s of r.skipped) {
      skipped[s.reason] += 1;
    }
  }
  return {
    caseId,
    added,
    links: resolved.reduce((n, r) => n + r.links.length, 0),
    pending: resolved.reduce((n, r) => n + r.pending.length, 0),
    skipped,
    shown,
  };
}

function detailLines(summary: AddedSummary): string[] {
  const lines: string[] = [];
  const { pending, skipped } = summary;
  if (summary.alreadyAdded) {
    lines.push(`-# ${summary.alreadyAdded} already added.`);
  }
  if (pending > 0) {
    lines.push(
      `-# ${plural(pending, "deleted message")} ${pending === 1 ? "is" : "are"} still being logged. Add ${pending === 1 ? "it" : "them"} later from **Suggested proof**.`,
    );
  }
  if (skipped.deleted_not_logged > 0) {
    const n = skipped.deleted_not_logged;
    lines.push(
      n === 1
        ? "-# 1 deleted message was skipped: its message log post never arrived."
        : `-# ${n} deleted messages were skipped: their message log posts never arrived.`,
    );
  }
  if (skipped.unchecked > 0) {
    const n = skipped.unchecked;
    lines.push(
      `-# ${plural(n, "message")} ${n === 1 ? "was" : "were"} skipped: sushii couldn't check ${n === 1 ? "it" : "them"}. Add ${n === 1 ? "it" : "them"} later from **Suggested proof**.`,
    );
  }
  if (summary.shown === "pending") {
    lines.push("-# Saved, but not shown on the mod log entry yet.");
  } else if (summary.shown === "not_shown") {
    lines.push("-# Saved, but it couldn't be shown on the mod log entry.");
  }
  return lines;
}

export function addedText(summary: AddedSummary): string {
  return [
    `✅ Added **${plural(summary.added, "suggestion")}** (${plural(summary.links, "link")}) to **Case #${summary.caseId}**`,
    ...detailLines(summary),
  ].join("\n");
}

export function nothingAddedText(summary: AddedSummary): string {
  return [
    summary.alreadyAdded
      ? `Nothing new was added to **Case #${summary.caseId}**.`
      : `Nothing was added to **Case #${summary.caseId}**: none of these messages could be linked.`,
    ...detailLines(summary),
  ].join("\n");
}

const LINKS_IN_ADDED = /\((\d+) links?\)/;

/** The link count shown on the Added message, so Undo can repeat it. */
export function linksFromAddedText(content: string | null): number | null {
  const match = content ? LINKS_IN_ADDED.exec(content) : null;
  return match ? Number(match[1]) : null;
}

export function undoneText(caseId: string, links: number | null): string {
  return links === null
    ? `Undone. Removed the suggested proof from Case #${caseId}.`
    : `Undone. Removed ${plural(links, "link")} from Case #${caseId}.`;
}

export function undoFailedText(removed: number, remaining: number): string {
  return `Removed ${removed} of ${removed + remaining} links; ${remaining} couldn't be removed. Try again.`;
}

export const UNDO_GONE_TEXT = "Already removed.";
export const UNDO_NOT_ALLOWED_TEXT =
  "Only the mod who added these can undo them.";
export const UNDO_UNAVAILABLE_TEXT = "That undo is no longer available.";
export const UNDO_ERROR_TEXT = "Couldn't undo that. Try again.";
export const OUT_OF_DATE_TEXT = "This button is out of date.";
export const SUGGESTIONS_CHANGED_TEXT =
  "Suggestions changed. Open Review to see the current ones.";
export const SUGGESTIONS_DIFFER_TEXT =
  "These suggestions are different for you. Open Review to see yours.";
export const NOTHING_SELECTED_TEXT = "Pick at least one suggestion first.";
export const ADD_FAILED_TEXT = "Couldn't add the suggestions. Try again.";
export const CASE_GONE_TEXT =
  "This case was deleted, so there's nothing to add proof to.";
