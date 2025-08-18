import type { GuildMember, InteractionReplyOptions, User } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

import type { UserLookupResult } from "@/features/moderation/cases/application/LookupUserService";
import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { getActionTypeEmoji } from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

import { formatBanEntry } from "./LookupBanEntryFormatter";

interface LookupOptions {
  showBasicInfo: boolean;
}

/**
 * Build user lookup container using components v2 - shows ALL cross-server bans
 * for comprehensive lookup command display.
 */
export function buildUserLookupReply(
  targetUser: User,
  member: GuildMember | null,
  lookupResult: UserLookupResult,
  options: LookupOptions,
): InteractionReplyOptions {
  const { userInfo, crossServerBans, currentGuildLookupOptIn } = lookupResult;

  const container = new ContainerBuilder().setAccentColor(Color.Info);

  // Cross-server bans section with user avatar
  const bansSection = buildBansSection(
    targetUser,
    crossServerBans,
    currentGuildLookupOptIn,
  );
  container.addSectionComponents(bansSection);

  if (options.showBasicInfo) {
    // Add separator
    container.addSeparatorComponents(new SeparatorBuilder());

    // Account information
    const accountSection = buildAccountSection(targetUser, userInfo);
    container.addTextDisplayComponents(accountSection);

    // Member information (only if user is in server)
    if (member) {
      container.addSeparatorComponents(new SeparatorBuilder());
      const memberSection = buildMemberSection(member);
      container.addTextDisplayComponents(memberSection);
    }
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function buildBansSection(
  targetUser: User,
  crossServerBans: UserLookupBan[],
  currentGuildLookupOptIn: boolean,
): SectionBuilder {
  const lookupEmoji = getActionTypeEmoji(ActionType.Lookup);
  const totalBans = crossServerBans.length;

  let content = `### ${lookupEmoji} **Cross-Server Bans** (${totalBans})\n`;

  if (totalBans === 0) {
    content += "> No bans found.";
  } else {
    // Character limit to prevent Discord message overflow (leaving room for other sections)
    const MAX_CONTENT_LENGTH = 3500;
    const banEntries: string[] = [];
    let currentLength = content.length;
    let bansShown = 0;

    for (const ban of crossServerBans) {
      const banEntry = formatBanEntry(ban, currentGuildLookupOptIn);
      const entryWithNewline = bansShown === 0 ? banEntry : `\n${banEntry}`;

      // Check if adding this ban would exceed the limit
      if (currentLength + entryWithNewline.length > MAX_CONTENT_LENGTH) {
        break;
      }

      banEntries.push(entryWithNewline);
      currentLength += entryWithNewline.length;
      bansShown++;
    }

    content += banEntries.join("");

    // Add "and X more" message if we truncated
    const remainingBans = totalBans - bansShown;
    if (remainingBans > 0) {
      content += `\n\n*and ${remainingBans} more ban${remainingBans === 1 ? "" : "s"}...*`;
    }
  }

  return new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(targetUser.displayAvatarURL({ size: 512 })),
    );
}

function buildAccountSection(
  targetUser: User,
  _userInfo: UserInfo,
): TextDisplayBuilder {
  const createdTimestamp = timestampToUnixTime(targetUser.createdTimestamp);

  const content = [
    "### 👤 Account Information",
    "",
    `**Username:** \`${targetUser.username}\``,
    `**Display Name:** \`${targetUser.globalName}\``,
    `**ID:** \`${targetUser.id}\``,
    `**Created:** <t:${createdTimestamp}:F> (<t:${createdTimestamp}:R>)`,
  ].join("\n");

  return new TextDisplayBuilder().setContent(content);
}

function buildMemberSection(member: GuildMember): TextDisplayBuilder {
  const joinedTimestamp = member.joinedTimestamp
    ? timestampToUnixTime(member.joinedTimestamp)
    : null;

  const joinedFormatted = joinedTimestamp
    ? `<t:${joinedTimestamp}:F> (<t:${joinedTimestamp}:R>)`
    : "Unknown";

  const content = [
    "### 🏠 Member Information",
    "",
    `**Joined:** ${joinedFormatted}`,
    `**Nickname:** ${member.nickname || "None"}`,
  ];

  // Add roles if user has any (excluding @everyone)
  if (member.roles.cache.size > 1) {
    const roles = member.roles.cache
      .filter((role) => role.name !== "@everyone")
      .sort((a, b) => b.position - a.position)
      .map((role) => role.toString())
      .join(", ");

    if (roles) {
      const rolesStr = `**Roles:** ${roles}`;

      content.push(rolesStr);
    }
  }

  return new TextDisplayBuilder().setContent(content.join("\n"));
}
