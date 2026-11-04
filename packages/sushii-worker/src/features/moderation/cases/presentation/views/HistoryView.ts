import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { CaseProofCounts } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import {
  ActionType,
  ActionTypeBotEmojis,
} from "@/features/moderation/shared/domain/value-objects/ActionType";
import { reasonDelivery } from "@/features/moderation/shared/presentation/proof/reasonBlock";
import {
  formatActionTypeAsSentence,
  getActionTypeBotEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import dayjs from "@/shared/domain/dayjs";
import { TAB_CONTENT_CHAR_BUDGET } from "@/shared/presentation/packLines";
import { countWithNoun } from "@/shared/presentation/pluralize";
import { quoteMarkdownString } from "@/utils/markdown";

export const HISTORY_ACTION_EMOJIS = [
  ...ActionTypeBotEmojis,
  "reason",
  "dm_sent",
  "lock",
  "duration",
  "attachment",
  "warning",
] as const satisfies readonly BotEmojiNameType[];

export type HistoryEmojis = EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

// Only a newline-heavy max-length reason reaches this: quoting adds "> " per
// line, and one oversized case would make Discord reject the whole page.
const MAX_CASE_LENGTH = TAB_CONTENT_CHAR_BUDGET;
// Overview shows rows too and has no select, so the pointer names the History tab.
const OVERSIZED_NOTE =
  "Too long to show here. Open it from History → View case.";

function prefixed(emoji: string, text: string): string {
  return emoji ? `${emoji} ${text}` : text;
}

/** The "Not sent" line under a reason that didn't reach the user. */
function notSentLine(moderationCase: ModerationCase): string {
  if (moderationCase.actionType === ActionType.Note) {
    return "";
  }

  const delivery = reasonDelivery(moderationCase);
  // Older cases recorded no DM outcome, so with no known cause there's no line.
  if (delivery.sent || !delivery.why) {
    return "";
  }

  return `\n> -# Not sent: ${delivery.why}`;
}

function proofCountLine(
  counts: CaseProofCounts | undefined,
  emojis: HistoryEmojis,
): string {
  if (!counts || counts.entries === 0) {
    return "";
  }

  let line = prefixed(emojis.lock, `${counts.entries} proof`);
  if (counts.files > 0) {
    line += ` · ${prefixed(emojis.attachment, countWithNoun(counts.files, "file"))}`;
  }

  return `\n> -# ${line}`;
}

export function formatModerationCase(
  moderationCase: ModerationCase,
  emojis: HistoryEmojis,
  showTargetMention = false,
  // Mod View's History tab drops these prepositions — mention pills already
  // read as people, and the standalone `/history` path never passes `true`.
  dropPrepositions = false,
  proofCounts?: CaseProofCounts,
): string {
  const emojiName = getActionTypeBotEmoji(moderationCase.actionType);
  const emoji = emojis[emojiName];

  let actionName = formatActionTypeAsSentence(moderationCase.actionType);

  // Add timeout duration if available for Timeout actions
  if (
    moderationCase.timeoutDuration &&
    moderationCase.actionType === ActionType.Timeout
  ) {
    const duration = dayjs.duration(moderationCase.timeoutDuration, "seconds");
    actionName += ` (${duration.humanize()})`;
  }

  const timestamp = dayjs.utc(moderationCase.actionTime).unix();

  let s = `\`#${moderationCase.caseId}\` · ${emoji} **${actionName}**`;

  if (showTargetMention) {
    s += dropPrepositions
      ? ` · <@${moderationCase.userId}>`
      : ` · on <@${moderationCase.userId}>`;
  }

  if (moderationCase.executorId) {
    s += dropPrepositions
      ? ` · <@${moderationCase.executorId}>`
      : ` · by <@${moderationCase.executorId}>`;
  }

  s += ` · <t:${timestamp}:R>`;

  const proofLine = proofCountLine(proofCounts, emojis);
  const reason = moderationCase.reason?.value;
  if (!reason) {
    return s + proofLine;
  }

  const notSent = notSentLine(moderationCase);
  const full = `${s}\n${quoteMarkdownString(reason)}${notSent}${proofLine}`;
  if (full.length <= MAX_CASE_LENGTH) {
    return full;
  }

  return `${s}\n> ${OVERSIZED_NOTE}${notSent}${proofLine}`;
}

export function spansMultipleUsers(cases: ModerationCase[]): boolean {
  return new Set(cases.map((c) => c.userId)).size > 1;
}
