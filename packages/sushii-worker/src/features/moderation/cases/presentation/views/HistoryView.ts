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
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import dayjs from "@/shared/domain/dayjs";
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

export function formatModerationCase(
  moderationCase: ModerationCase,
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
  showTargetMention = false,
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

  let s = `\`#${moderationCase.caseId}\` • ${emoji} **${actionName}**`;

  if (showTargetMention) {
    s += ` – on <@${moderationCase.userId}>`;
  }

  s += ` – <t:${timestamp}:R>`;

  if (moderationCase.executorId) {
    s += ` – by <@${moderationCase.executorId}>`;
  }

  if (moderationCase.reason) {
    s += `\n` + quoteMarkdownString(moderationCase.reason.value);
  }

  if (moderationCase.attachments.length > 0) {
    const validAttachments = moderationCase.attachments.filter(
      (a): a is string => !!a,
    );
    if (validAttachments.length > 0) {
      const attachmentLinks = validAttachments
        .map((a) => `[${getCleanFilename(a)}](${a})`)
        .join(", ");
      s += `\n> 📎 ${attachmentLinks}`;
    }
  }

  return s;
}

function getMergedAccountCount(historyResult: UserHistoryResult): number {
  return historyResult.linkedIdentity?.members.length ?? 0;
}

export function spansMultipleUsers(cases: ModerationCase[]): boolean {
  return new Set(cases.map((c) => c.userId)).size > 1;
}

// Discord caps a single Text Display component's content at 4000 characters.
// A case's reason can run up to 1024 characters and isn't truncated, so pages
// are packed by rendered length rather than a fixed case count — leaves
// enough margin that the header/summary/nav text added around it never pushes
// the *cases* Text Display itself over the limit.
const HISTORY_PAGE_CHAR_BUDGET = 3500;

/**
 * Splits history into pages sized to fit safely under Discord's Text Display
 * character limit. A single case's rendered length (even with a max-length
 * reason and attachments) is always well under the budget, so every page
 * holds at least one case.
 */
export function buildHistoryPages(
  moderationHistory: ModerationCase[],
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
  showTargetMention: boolean,
): ModerationCase[][] {
  const pages: ModerationCase[][] = [];

  let currentPage: ModerationCase[] = [];
  let currentLength = 0;

  for (const moderationCase of moderationHistory) {
    const lineLength = formatModerationCase(
      moderationCase,
      emojis,
      showTargetMention,
    ).length;
    const separatorLength = currentPage.length > 0 ? 1 : 0; // joining "\n"
    const projectedLength = currentLength + separatorLength + lineLength;

    if (projectedLength > HISTORY_PAGE_CHAR_BUDGET && currentPage.length > 0) {
      pages.push(currentPage);
      currentPage = [moderationCase];
      currentLength = lineLength;
    } else {
      currentPage.push(moderationCase);
      currentLength = projectedLength;
    }
  }

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  return pages;
}

function buildCaseSummary(
  moderationHistory: ModerationCase[],
): Map<ActionType, number> {
  return moderationHistory.reduce((summary, moderationCase) => {
    const { actionType } = moderationCase;
    const oldCount = summary.get(actionType) || 0;
    summary.set(actionType, oldCount + 1);

    return summary;
  }, new Map<ActionType, number>());
}

function buildUserHeaderSection(
  targetUser: User,
  member: GuildMember | null,
  totalCases: number,
  linkedIdentity: AltIdentityWithMembers | null,
): SectionBuilder {
  const title = `### Moderation History — ${totalCases} case${totalCases === 1 ? "" : "s"}\n<@${targetUser.id}>`;

  const lines = [title];

  if (linkedIdentity && linkedIdentity.members.length > 1) {
    const mentions = linkedIdentity.members
      .map((m) => `<@${m.userId}>`)
      .join(" ");
    lines.push(
      `*Merged history for ${linkedIdentity.members.length} linked accounts: ${mentions} — use \`/alts\` to manage.*`,
    );
  }

  const createdTimestamp = timestampToUnixTime(targetUser.createdTimestamp);
  const dateParts = [
    `Account created <t:${createdTimestamp}:F> (<t:${createdTimestamp}:R>)`,
  ];

  if (member?.joinedTimestamp) {
    const joinedTimestamp = timestampToUnixTime(member.joinedTimestamp);
    dateParts.push(
      `Joined server <t:${joinedTimestamp}:F> (<t:${joinedTimestamp}:R>)`,
    );
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
      ? "*No moderation cases found in this server.*"
      : pageCases
          .map((c) => formatModerationCase(c, emojis, showTargetMention))
          .join("\n");

  return new TextDisplayBuilder().setContent(content);
}

function buildSummarySection(
  moderationHistory: ModerationCase[],
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
): TextDisplayBuilder {
  const summary = buildCaseSummary(moderationHistory);
  const summaryStr = Array.from(summary.entries()).map(([actionType, num]) => {
    const emoji = emojis[getActionTypeBotEmoji(actionType)];
    const action = formatActionTypeAsSentence(actionType);
    return `${emoji} **${action}** – ${num}`;
  });

  return new TextDisplayBuilder().setContent(
    `**Summary**\n${summaryStr.join("\n")}`,
  );
}

/**
 * Builds one page of the `/history` command: user header (with a merged-alts
 * note when applicable), the page's cases (newest-first — the most relevant
 * cases are the most recent ones, regardless of which linked account they're
 * on), and a summary of the full history across every page.
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
  const { moderationHistory, totalCases } = historyResult;

  const container = new ContainerBuilder().setAccentColor(Color.Success);

  container.addSectionComponents(
    buildUserHeaderSection(
      targetUser,
      member,
      totalCases,
      historyResult.linkedIdentity,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    buildCasesSection(pageCases, emojis, showTargetMention),
  );

  if (moderationHistory.length > 0) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      buildSummarySection(moderationHistory, emojis),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# User ID: ${targetUser.id}`),
  );

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
    footerParts.push(`Showing 3 of ${totalCases} cases. Use /history for full list`);
  }
  if (footerParts.length > 0) {
    embed.setFooter({ text: footerParts.join(" • ") });
  }

  return embed;
}
