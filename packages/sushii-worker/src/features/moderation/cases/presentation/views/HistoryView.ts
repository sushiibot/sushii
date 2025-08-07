import { EmbedBuilder, GuildMember, User } from "discord.js";

import { UserLookupResult } from "@/features/moderation/cases/application/LookupUserService";
import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  formatActionTypeAsSentence,
  getActionTypeEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import dayjs from "@/shared/domain/dayjs";
import buildChunks from "@/utils/buildChunks";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";
import { getCleanFilename } from "@/utils/url";
import { getUserString } from "@/utils/userString";

export function buildUserHistoryEmbeds(
  targetUser: User,
  member: GuildMember | null,
  historyResult: UserLookupResult,
): EmbedBuilder[] {
  const { moderationHistory, totalCases } = historyResult;
  const count = totalCases;

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
    return [mainEmbed];
  }

  const summary = buildCaseSummary(moderationHistory);
  const summaryStr = Array.from(summary.entries()).map(
    ([action, num]) => `**${action}** – ${num}`,
  );

  // Build case history
  const casesStr = moderationHistory.map((moderationCase) => {
    const actionEmoji = getActionTypeEmoji(moderationCase.actionType);
    let actionName = formatActionTypeAsSentence(moderationCase.actionType);

    // Add timeout duration if available for Timeout actions
    if (
      moderationCase.timeoutDuration &&
      moderationCase.actionType === ActionType.Timeout
    ) {
      const duration = dayjs.duration(
        moderationCase.timeoutDuration,
        "seconds",
      );
      actionName += ` (${duration.humanize()})`;
    }

    const timestamp = dayjs.utc(moderationCase.actionTime).unix();

    let s =
      `\`#${moderationCase.caseId}\`` +
      ` ${actionEmoji} **${actionName}**` +
      ` – <t:${timestamp}:R> `;

    const hasExecutor = moderationCase.executorId;
    const hasReason = moderationCase.reason;
    const hasAttachments =
      moderationCase.attachments && moderationCase.attachments.length > 0;

    if (hasExecutor) {
      s += `\n> **By:** <@${moderationCase.executorId}>`;
    }

    if (hasReason) {
      s += `\n> **Reason:** ${moderationCase.reason.value}`;
    }

    if (hasAttachments) {
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
  });

  const descChunks = buildChunks(casesStr, "\n", 4096);

  // First embed gets first chunk
  mainEmbed.setDescription(descChunks[0]);

  // Additional embeds get the rest excluding first chunk
  const additionalEmbeds = descChunks
    .slice(1)
    .map((desc) =>
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
  addUserAccountInfo(allEmbeds[allEmbeds.length - 1], targetUser, member);

  return allEmbeds;
}

export function buildCaseSummary(
  moderationHistory: ModerationCase[],
): Map<string, number> {
  return moderationHistory.reduce((summary, moderationCase) => {
    const actionStr = formatActionTypeAsSentence(moderationCase.actionType);
    const oldCount = summary.get(actionStr) || 0;
    summary.set(actionStr, oldCount + 1);
    return summary;
  }, new Map<string, number>());
}

export function addUserAccountInfo(
  embed: EmbedBuilder,
  targetUser: User,
  member: GuildMember | null,
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

  embed.addFields(fields).setFooter({
    text: `User ID: ${targetUser.id}`,
  });
}
