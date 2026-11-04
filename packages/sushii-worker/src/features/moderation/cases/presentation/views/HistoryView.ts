import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis";
import type {
  DMFailureReason,
  ModerationCase,
} from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { CaseProofCounts } from "@/features/moderation/shared/domain/repositories/CaseProofRepository";
import {
  ActionType,
  ActionTypeBotEmojis,
  actionTypeSupportsDM,
} from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  formatActionType,
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
  "additional_message",
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

const DM_FAILURE_TEXT: Record<DMFailureReason, string> = {
  user_blocked: "they have DMs off or blocked sushii",
  user_privacy: "they have server DMs off or share no server with sushii",
  user_cannot_receive: "Discord won't deliver DMs to them",
  unknown: "the DM failed",
};

export type ReasonDelivery =
  | { sent: true }
  | { sent: false; why: string | null };

/** Whether the user still has the reason in their DMs, and if not, why. */
export function reasonDelivery(moderationCase: ModerationCase): ReasonDelivery {
  if (moderationCase.dmDeleted) {
    const by = moderationCase.dmDeletedBy
      ? ` by <@${moderationCase.dmDeletedBy}>`
      : "";
    return { sent: false, why: `DM deleted${by}` };
  }

  const dm = moderationCase.dmResult;
  if (dm?.channelId && dm.messageId) {
    return { sent: true };
  }

  if (dm?.error || moderationCase.dmFailureReason) {
    const failure =
      moderationCase.dmFailureReason ?? dm?.failureReason ?? "unknown";
    return { sent: false, why: DM_FAILURE_TEXT[failure] };
  }

  if (!actionTypeSupportsDM(moderationCase.actionType)) {
    return { sent: false, why: null };
  }

  if (moderationCase.dmNotAttemptedReason === "user_not_in_guild") {
    return { sent: false, why: "they weren't in the server" };
  }

  switch (moderationCase.dmIntentSource) {
    case "executor_no":
      return { sent: false, why: "the mod chose no DM" };
    case "guild_default":
      return {
        sent: false,
        why: `${formatActionType(moderationCase.actionType)} DMs are off`,
      };
    default:
      return { sent: false, why: null };
  }
}

function prefixed(emoji: string, text: string): string {
  return emoji ? `${emoji} ${text}` : text;
}

/** The reason's emoji and any "Not sent" line; null when there's no reason. */
function reasonParts(
  moderationCase: ModerationCase,
  emojis: HistoryEmojis,
): { emoji: string; notSent: string } | null {
  if (!moderationCase.reason?.value) {
    return null;
  }

  if (moderationCase.actionType === ActionType.Note) {
    return { emoji: emojis.lock, notSent: "" };
  }

  const delivery = reasonDelivery(moderationCase);
  if (delivery.sent) {
    return { emoji: emojis.additional_message, notSent: "" };
  }

  // Older cases recorded no DM outcome, so with no known cause there's no line.
  const notSent = delivery.why ? `\n> -# Not sent: ${delivery.why}` : "";
  return { emoji: emojis.reason, notSent };
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
  const parts = reasonParts(moderationCase, emojis);
  if (!parts || !moderationCase.reason) {
    return s + proofLine;
  }

  const quoted = quoteMarkdownString(
    prefixed(parts.emoji, moderationCase.reason.value),
  );
  const full = `${s}\n${quoted}${parts.notSent}${proofLine}`;
  if (full.length <= MAX_CASE_LENGTH) {
    return full;
  }

  return `${s}\n> ${prefixed(parts.emoji, OVERSIZED_NOTE)}${parts.notSent}${proofLine}`;
}

export function spansMultipleUsers(cases: ModerationCase[]): boolean {
  return new Set(cases.map((c) => c.userId)).size > 1;
}
