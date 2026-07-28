import type {
  ActionRowBuilder,
  ButtonBuilder,
  GuildMember,
  User,
} from "discord.js";
import {
  ContainerBuilder,
  EmbedBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

import type { AltIdentityWithMembers } from "@/features/alt-accounts/domain/types";
import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis";
import type { UserHistoryResult } from "@/features/moderation/cases/application/HistoryUserService";
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
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import {
  TAB_CONTENT_CHAR_BUDGET,
  chunkItems,
} from "@/shared/presentation/packLines";
import Color from "@/utils/colors";
import { quoteMarkdownString } from "@/utils/markdown";
import timestampToUnixTime from "@/utils/timestampToUnixTime";
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

function getMergedAccountCount(historyResult: UserHistoryResult): number {
  return historyResult.linkedIdentity?.members.length ?? 0;
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

function buildUserHeaderSection(
  targetUser: User,
  member: GuildMember | null,
  totalCases: number,
): SectionBuilder {
  const title = `### Moderation History — ${totalCases} case${totalCases === 1 ? "" : "s"}\n<@${targetUser.id}>`;

  const lines = [title];

  const createdTimestamp = timestampToUnixTime(targetUser.createdTimestamp);
  const dateParts = [`Account created <t:${createdTimestamp}:R>`];

  if (member?.joinedTimestamp) {
    const joinedTimestamp = timestampToUnixTime(member.joinedTimestamp);
    dateParts.push(`Joined server <t:${joinedTimestamp}:R>`);
  }

  lines.push(dateParts.join(" • "));

  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(targetUser.displayAvatarURL({ size: 512 })),
    );
}

function buildCasesSection(
  pageCases: ModerationCase[],
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
  showTargetMention: boolean,
): TextDisplayBuilder {
  const content =
    pageCases.length === 0
      ? "**No moderation cases found**\n-# This server has no moderation history for this user."
      : pageCases
          .map((c) => formatModerationCase(c, emojis, showTargetMention))
          .join("\n");

  return new TextDisplayBuilder().setContent(content);
}

function buildLinkedAccountsSection(
  linkedIdentity: AltIdentityWithMembers,
): TextDisplayBuilder {
  const mentions = linkedIdentity.members
    .map((m) => `<@${m.userId}>`)
    .join(" ");

  return new TextDisplayBuilder().setContent(
    [
      `**Merged history for ${linkedIdentity.members.length} linked alt accounts**`,
      mentions,
      "-# use `/alts` to manage alts",
    ].join("\n"),
  );
}

/**
 * Builds one page of the `/history` command: user header and the page's
 * cases (oldest at top, newest at bottom, chat-log style — page 1 holds the
 * most recent cases overall, and later pages go further back regardless of
 * which linked account a case is on).
 */
export function buildHistoryPageContainer(
  targetUser: User,
  member: GuildMember | null,
  historyResult: UserHistoryResult,
  pageCases: ModerationCase[],
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
  showTargetMention: boolean,
  navButtons: ActionRowBuilder<ButtonBuilder> | null,
  isDisabled: boolean,
): ContainerBuilder {
  const { totalCases } = historyResult;

  const container = new ContainerBuilder().setAccentColor(Color.Success);

  container.addSectionComponents(
    buildUserHeaderSection(targetUser, member, totalCases),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    buildCasesSection(pageCases, emojis, showTargetMention),
  );

  const { linkedIdentity } = historyResult;
  if (linkedIdentity && linkedIdentity.members.length > 1) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      buildLinkedAccountsSection(linkedIdentity),
    );
  }

  ComponentsV2Paginator.addNavigationSection(container, navButtons, isDisabled);

  return container;
}

export function buildUserHistoryContextEmbed(
  targetUser: User,
  member: GuildMember | null,
  historyResult: UserHistoryResult,
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
): EmbedBuilder {
  const { moderationHistory, totalCases } = historyResult;
  const mergedAccountCount = getMergedAccountCount(historyResult);

  const embed = new EmbedBuilder()
    .setTitle(
      `Recent Moderation History (${totalCases} case${totalCases === 1 ? "" : "s"})`,
    )
    .setColor(Color.Success);

  if (moderationHistory.length === 0) {
    embed.setDescription("No moderation history found in this server.");
    return embed;
  }

  // moderationHistory is ordered oldest-first (ascending case ID), so the
  // most recent cases are at the end — take the last 3 and show newest first.
  const recentCases = moderationHistory.slice(-3).reverse();
  const showTargetMention = spansMultipleUsers(recentCases);
  const casesStr = recentCases
    .map((c) => formatModerationCase(c, emojis, showTargetMention))
    .join("\n\n");

  embed.setDescription(casesStr);

  // Add footer with instruction to use /history for full list
  const footerParts = [];
  if (mergedAccountCount > 1) {
    footerParts.push(`Merged across ${mergedAccountCount} linked accounts`);
  }
  if (totalCases > 3) {
    footerParts.push(
      `Showing 3 of ${totalCases} cases. Use /history for full list`,
    );
  }
  if (footerParts.length > 0) {
    embed.setFooter({ text: footerParts.join(" • ") });
  }

  return embed;
}
