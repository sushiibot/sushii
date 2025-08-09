import type { GuildMember, User } from "discord.js";
import { EmbedBuilder } from "discord.js";

import type { UserLookupResult } from "@/features/moderation/cases/application/LookupUserService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

import { formatModerationCase } from "./HistoryView";

interface LookupOptions {
  botHasBanPermission: boolean;
  showBasicInfo: boolean;
}

export function buildUserLookupEmbed(
  targetUser: User,
  member: GuildMember | null,
  lookupResult: UserLookupResult,
  options: LookupOptions,
): EmbedBuilder {
  const { userInfo, moderationHistory, totalCases } = lookupResult;

  const embed = new EmbedBuilder()
    .setColor(Color.Info)
    .setTitle(`User Lookup: ${targetUser.tag}`)
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .setTimestamp();

  if (options.showBasicInfo) {
    addBasicUserInfo(embed, targetUser, userInfo, member);
  }

  if (moderationHistory.length > 0) {
    addModerationHistory(embed, moderationHistory);
  } else {
    embed.addFields({
      name: "Moderation History",
      value: "No moderation history found in this server.",
      inline: false,
    });
  }

  embed.addFields({
    name: "Total Cases",
    value: totalCases.toString(),
    inline: true,
  });

  return embed;
}

function addBasicUserInfo(
  embed: EmbedBuilder,
  targetUser: User,
  userInfo: UserInfo,
  member: GuildMember | null,
): void {
  const createdTimestamp = timestampToUnixTime(targetUser.createdTimestamp);
  const accountAgeFormatted = `<t:${createdTimestamp}:R>`;

  embed.addFields({
    name: "Account Info",
    value: [
      `**ID:** ${targetUser.id}`,
      `**Created:** ${accountAgeFormatted}`,
      `**Bot:** ${targetUser.bot ? "Yes" : "No"}`,
    ].join("\n"),
    inline: true,
  });

  if (member) {
    const joinedTimestamp = member.joinedTimestamp
      ? timestampToUnixTime(member.joinedTimestamp)
      : null;

    const joinedFormatted = joinedTimestamp
      ? `<t:${joinedTimestamp}:R>`
      : "Unknown";

    embed.addFields({
      name: "Member Info",
      value: [
        `**Joined:** ${joinedFormatted}`,
        `**Nickname:** ${member.nickname || "None"}`,
        `**Roles:** ${member.roles.cache.size - 1}`, // Subtract @everyone
      ].join("\n"),
      inline: true,
    });

    if (member.roles.cache.size > 1) {
      const roles = member.roles.cache
        .filter((role) => role.name !== "@everyone")
        .sort((a, b) => b.position - a.position)
        .map((role) => role.toString())
        .slice(0, 10)
        .join(", ");

      if (roles) {
        embed.addFields({
          name: "Roles",
          value: roles,
          inline: false,
        });
      }
    }
  } else {
    embed.addFields({
      name: "Member Info",
      value: "User is not in this server.",
      inline: true,
    });
  }
}

function addModerationHistory(
  embed: EmbedBuilder,
  moderationHistory: ModerationCase[],
): void {
  const recentCases = moderationHistory.slice(0, 5);

  const historyValue = recentCases.map(formatModerationCase).join("\n\n");

  embed.addFields({
    name: `Recent Moderation History (${recentCases.length}/${moderationHistory.length})`,
    value: historyValue || "No moderation history found.",
    inline: false,
  });

  if (moderationHistory.length > 5) {
    embed.setFooter({
      text: `Showing 5 of ${moderationHistory.length} total cases. Use /history for full list.`,
    });
  }
}
