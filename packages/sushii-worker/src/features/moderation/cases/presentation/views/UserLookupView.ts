import type { GuildMember, User } from "discord.js";
import { EmbedBuilder } from "discord.js";

import type { UserLookupResult } from "@/features/moderation/cases/application/LookupUserService";
import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

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
  const { userInfo, crossServerBans } = lookupResult;

  const embed = new EmbedBuilder()
    .setColor(Color.Info)
    .setTitle(`User Lookup: ${targetUser.tag}`)
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .setTimestamp();

  if (options.showBasicInfo) {
    addBasicUserInfo(embed, targetUser, userInfo, member);
  }

  // Add cross-server bans section
  if (crossServerBans.length > 0) {
    addCrossServerBans(embed, crossServerBans, options);
  } else {
    embed.addFields({
      name: "Cross-Server Bans",
      value: "No cross-server bans found.",
      inline: false,
    });
  }

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

function addCrossServerBans(
  embed: EmbedBuilder,
  crossServerBans: UserLookupBan[],
  _options: LookupOptions,
): void {
  const displayBans = crossServerBans.slice(0, 5);

  const banValues = displayBans.map((ban) => {
    const parts: string[] = [];
    
    if (ban.guildName) {
      parts.push(`**${ban.guildName}**`);
    }

    if (ban.actionTime) {
      const timestamp = timestampToUnixTime(ban.actionTime.getTime());
      parts.push(`<t:${timestamp}:R>`);
    }

    if (ban.reason && ban.lookupDetailsOptIn) {
      const truncatedReason = ban.reason.length > 100 
        ? `${ban.reason.slice(0, 100)}...` 
        : ban.reason;
      parts.push(`Reason: ${truncatedReason}`);
    }

    return parts.join("\n");
  }).join("\n\n");

  embed.addFields({
    name: `Cross-Server Bans (${displayBans.length}/${crossServerBans.length})`,
    value: banValues || "No ban details available.",
    inline: false,
  });

  if (crossServerBans.length > 5) {
    const currentFooterText = embed.data.footer?.text ?? "";
    const newFooterText = currentFooterText 
      ? `${currentFooterText} • Showing 5 of ${crossServerBans.length} cross-server bans.`
      : `Showing 5 of ${crossServerBans.length} cross-server bans.`;
    
    embed.setFooter({ text: newFooterText });
  }
}
