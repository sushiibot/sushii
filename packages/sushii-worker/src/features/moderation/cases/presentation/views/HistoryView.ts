import { EmbedBuilder, GuildMember, User } from "discord.js";

import { UserLookupResult } from "@/features/moderation/cases/application/LookupUserService";
import dayjs from "@/shared/domain/dayjs";
import buildChunks from "@/utils/buildChunks";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";
import { getUserString } from "@/utils/userString";

import { ModerationCase } from "../../../shared/domain/entities/ModerationCase";
import {
  formatActionTypeAsSentence,
  getActionTypeEmoji,
} from "../../../shared/presentation/views/ActionTypeFormatter";

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
    ([action, num]) => `**${action}** - ${num}`,
  );

  // Build case history
  const casesStr = moderationHistory.map((moderationCase) => {
    const actionEmoji = getActionTypeEmoji(moderationCase.actionType);
    const actionName = formatActionTypeAsSentence(moderationCase.actionType);
    const timestamp = dayjs.utc(moderationCase.actionTime).unix();

    let s =
      `${actionEmoji} ` +
      `\`#${moderationCase.caseId}\` - ` +
      `**${actionName}** ` +
      `<t:${timestamp}:R> `;

    if (moderationCase.reason && moderationCase.executorId) {
      s += `\n┣ **By:** <@${moderationCase.executorId}>`;
    }

    if (moderationCase.reason) {
      s += `\n┗ **Reason:** ${moderationCase.reason.value}`;
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
