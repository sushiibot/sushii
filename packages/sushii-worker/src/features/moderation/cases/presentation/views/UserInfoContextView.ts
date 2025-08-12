import type { GuildMember, User } from "discord.js";
import { EmbedBuilder } from "discord.js";

import type { UserLookupResult } from "@/features/moderation/cases/application/LookupUserService";
import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

import { formatBanEntry } from "./LookupBanEntryFormatter";

// Constants for context menu display limits
const CONTEXT_MAX_BANS = 5;
const CONTEXT_MAX_REASON_LENGTH = 100;

interface LookupContextOptions {
  showBasicInfo: boolean;
}

/**
 * Build user lookup embed for context menu - shows truncated ban list (max 5)
 * for use in summary contexts where space is limited.
 */
export function buildUserLookupContextEmbed(
  targetUser: User,
  member: GuildMember | null,
  lookupResult: UserLookupResult,
  options: LookupContextOptions,
): EmbedBuilder {
  const { userInfo, crossServerBans, currentGuildLookupOptIn } = lookupResult;

  const embed = new EmbedBuilder()
    .setColor(Color.Info)
    .setTitle(`User Lookup: ${targetUser.tag}`)
    .setThumbnail(targetUser.displayAvatarURL({ size: 256 }))
    .setTimestamp();

  if (options.showBasicInfo) {
    addBasicUserInfoContext(embed, targetUser, userInfo, member);
  }

  // Add cross-server bans section (truncated for context)
  if (crossServerBans.length > 0) {
    addCrossServerBansContext(
      embed,
      crossServerBans,
      currentGuildLookupOptIn,
      options,
    );
  } else {
    embed.addFields({
      name: "Cross-Server Bans",
      value: "No cross-server bans found.",
      inline: false,
    });
  }

  return embed;
}

function addBasicUserInfoContext(
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

function addCrossServerBansContext(
  embed: EmbedBuilder,
  crossServerBans: UserLookupBan[],
  currentGuildLookupOptIn: boolean,
  _options: LookupContextOptions,
): void {
  // Truncate to max bans for context menu summary
  const displayBans = crossServerBans.slice(0, CONTEXT_MAX_BANS);

  // Use shared formatter for ban entries (with truncated reasons for context)
  const banValues = displayBans
    .map((ban) => {
      let formattedEntry = formatBanEntry(ban, currentGuildLookupOptIn);

      // Truncate long reasons for context menu display
      if (ban.reason && ban.lookupDetailsOptIn && currentGuildLookupOptIn) {
        const lines = formattedEntry.split("\n");
        if (lines.length > 1 && lines[1].startsWith("> ")) {
          const reason = lines[1].substring(2); // Remove "> " prefix
          if (reason.length > CONTEXT_MAX_REASON_LENGTH) {
            const truncatedReason = `${reason.slice(0, CONTEXT_MAX_REASON_LENGTH)}...`;
            lines[1] = `> ${truncatedReason}`;
            formattedEntry = lines.join("\n");
          }
        }
      }

      return formattedEntry;
    })
    .join("\n\n");

  embed.addFields({
    name: `Cross-Server Bans (${displayBans.length}/${crossServerBans.length})`,
    value: banValues || "No ban details available.",
    inline: false,
  });

  if (crossServerBans.length > CONTEXT_MAX_BANS) {
    const currentFooterText = embed.data.footer?.text ?? "";
    const newFooterText = currentFooterText
      ? `${currentFooterText} • Showing ${CONTEXT_MAX_BANS} of ${crossServerBans.length} cross-server bans.`
      : `Showing ${CONTEXT_MAX_BANS} of ${crossServerBans.length} cross-server bans.`;

    embed.setFooter({ text: newFooterText });
  }
}
