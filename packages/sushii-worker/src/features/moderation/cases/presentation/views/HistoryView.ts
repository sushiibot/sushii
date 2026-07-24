import type { GuildMember, User } from "discord.js";
import { EmbedBuilder } from "discord.js";

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
import buildChunks from "@/utils/buildChunks";
import Color from "@/utils/colors";
import { quoteMarkdownString } from "@/utils/markdown";
import timestampToUnixTime from "@/utils/timestampToUnixTime";
import { getCleanFilename } from "@/utils/url";
import { getUserString } from "@/utils/userString";

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

  let s = `\`#${moderationCase.caseId}\` • ${emoji} **${actionName}**  – <t:${timestamp}:R>`;

  if (showTargetMention) {
    s += ` – on <@${moderationCase.userId}>`;
  }

  if (moderationCase.executorId) {
    s += ` – <@${moderationCase.executorId}>`;
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

function spansMultipleUsers(cases: ModerationCase[]): boolean {
  return new Set(cases.map((c) => c.userId)).size > 1;
}

export function buildUserHistoryEmbeds(
  targetUser: User,
  member: GuildMember | null,
  historyResult: UserHistoryResult,
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
): EmbedBuilder[] {
  const { moderationHistory, totalCases } = historyResult;
  const count = totalCases;
  const mergedAccountCount = getMergedAccountCount(historyResult);

  const mainEmbed = new EmbedBuilder()
    .setTitle(`Moderation History (${count} case${count === 1 ? "" : "s"})`)
    .setColor(Color.Success);

  // Add user info to first embed
  mainEmbed.setAuthor({
    name: getUserString(member || targetUser),
    iconURL: targetUser.displayAvatarURL(),
  });

  // No description if no cases
  if (moderationHistory.length === 0) {
    addUserAccountInfo(mainEmbed, targetUser, member, mergedAccountCount);
    return [mainEmbed];
  }

  const summary = buildCaseSummary(moderationHistory);
  const summaryStr = Array.from(summary.entries()).map(([actionType, num]) => {
    const emoji = emojis[getActionTypeBotEmoji(actionType)];
    const action = formatActionTypeAsSentence(actionType);
    return `${emoji} **${action}** – ${num}`;
  });

  // Only tag each case with its target when the cases actually span more
  // than one linked account — no point calling that out otherwise.
  const showTargetMention = spansMultipleUsers(moderationHistory);

  // Build case history
  const casesStr = moderationHistory.map((c) =>
    formatModerationCase(c, emojis, showTargetMention),
  );

  const [firstChunk, ...additionalChunks] = buildChunks(casesStr, "\n", 3500);

  const mergedNote =
    mergedAccountCount > 1
      ? `*Merged history across ${mergedAccountCount} linked accounts — see \`/alts view\`.*\n\n`
      : "";

  // First embed gets first chunk
  mainEmbed.setDescription(mergedNote + firstChunk);

  // Additional embeds get the rest excluding first chunk
  const additionalEmbeds = additionalChunks.map((desc) =>
    new EmbedBuilder()
      .setTitle("Case History (Continued)")
      .setColor(Color.Success)
      .setDescription(desc),
  );

  if (additionalEmbeds.length > 0) {
    // Add summary to last embed
    additionalEmbeds[additionalEmbeds.length - 1].addFields([
      {
        name: "Summary",
        value: summaryStr.join("\n"),
      },
    ]);
  } else {
    // Add summary to first embed
    mainEmbed.addFields([
      {
        name: "Summary",
        value: summaryStr.join("\n"),
      },
    ]);
  }

  const allEmbeds = [mainEmbed, ...additionalEmbeds];

  // Add user account info to the last embed
  addUserAccountInfo(
    allEmbeds[allEmbeds.length - 1],
    targetUser,
    member,
    mergedAccountCount,
  );

  return allEmbeds;
}

export function buildCaseSummary(
  moderationHistory: ModerationCase[],
): Map<ActionType, number> {
  return moderationHistory.reduce((summary, moderationCase) => {
    const { actionType } = moderationCase;
    const oldCount = summary.get(actionType) || 0;
    summary.set(actionType, oldCount + 1);

    return summary;
  }, new Map<ActionType, number>());
}

export function addUserAccountInfo(
  embed: EmbedBuilder,
  targetUser: User,
  member: GuildMember | null,
  mergedAccountCount = 0,
): void {
  const createdTimestamp = timestampToUnixTime(targetUser.createdTimestamp);
  const fields = [
    {
      name: "Account Created",
      value: `<t:${createdTimestamp}:F> (<t:${createdTimestamp}:R>)`,
    },
  ];

  if (member?.joinedTimestamp) {
    const joinedTimestamp = timestampToUnixTime(member.joinedTimestamp);
    fields.push({
      name: "Joined Server",
      value: `<t:${joinedTimestamp}:F> (<t:${joinedTimestamp}:R>)`,
    });
  }

  const footerText =
    mergedAccountCount > 1
      ? `User ID: ${targetUser.id} • merged across ${mergedAccountCount} linked accounts`
      : `User ID: ${targetUser.id}`;

  embed.addFields(fields).setFooter({
    text: footerText,
  });
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
