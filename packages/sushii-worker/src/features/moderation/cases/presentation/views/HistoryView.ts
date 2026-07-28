import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import {
  ActionType,
  ActionTypeBotEmojis,
} from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  formatActionTypeAsSentence,
  getActionTypeBotEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import dayjs from "@/shared/domain/dayjs";
import {
  TAB_CONTENT_CHAR_BUDGET,
  chunkItems,
} from "@/shared/presentation/packLines";
import { quoteMarkdownString } from "@/utils/markdown";
import { getCleanFilename } from "@/utils/url";

export const HISTORY_ACTION_EMOJIS = [
  ...ActionTypeBotEmojis,
  "reason",
  "duration",
  "attachment",
  "warning",
] as const satisfies readonly BotEmojiNameType[];

// A single case must never approach Discord's 4000-char Text Display limit on
// its own — a max-length reason (quoted, newline-heavy) plus several signed
// CDN attachment links can otherwise exceed it, which throws rather than
// degrading. The head (identifier, type, attribution, timestamp) always
// survives; only the reason/attachment continuation is truncated to fit.
const MAX_CASE_LENGTH = TAB_CONTENT_CHAR_BUDGET;
const TRUNCATION_NOTE = "\n> (truncated)";

function capContinuation(continuation: string, budget: number): string {
  if (continuation.length <= budget) {
    return continuation;
  }

  const keep = Math.max(0, budget - TRUNCATION_NOTE.length);
  return continuation.slice(0, keep) + TRUNCATION_NOTE;
}

export function formatModerationCase(
  moderationCase: ModerationCase,
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
  showTargetMention = false,
  // Mod View's History tab drops these prepositions — mention pills already
  // read as people, and the standalone `/history` path never passes `true`.
  dropPrepositions = false,
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

  let continuation = "";

  if (moderationCase.reason) {
    continuation += `\n` + quoteMarkdownString(moderationCase.reason.value);
  }

  if (moderationCase.attachments.length > 0) {
    const validAttachments = moderationCase.attachments.filter(
      (a): a is string => !!a,
    );
    if (validAttachments.length > 0) {
      const attachmentLinks = validAttachments
        .map((a) => `[${getCleanFilename(a)}](${a})`)
        .join(", ");
      continuation += `\n> ${emojis.attachment} ${attachmentLinks}`;
    }
  }

  const continuationBudget = Math.max(0, MAX_CASE_LENGTH - s.length);

  return s + capContinuation(continuation, continuationBudget);
}

export function spansMultipleUsers(cases: ModerationCase[]): boolean {
  return new Set(cases.map((c) => c.userId)).size > 1;
}

/**
 * Splits history into pages sized to fit safely under Discord's Text Display
 * character limit. `formatModerationCase` caps a single case's rendered
 * length to `MAX_CASE_LENGTH`, so every page holds at least one case.
 */
export function buildHistoryPages(
  moderationHistory: ModerationCase[],
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
  showTargetMention: boolean,
): ModerationCase[][] {
  return chunkItems(moderationHistory, (moderationCase) =>
    formatModerationCase(moderationCase, emojis, showTargetMention),
  );
}
