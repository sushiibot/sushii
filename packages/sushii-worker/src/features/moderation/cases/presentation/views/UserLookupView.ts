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
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { getActionTypeEmoji } from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

import { formatBanEntry } from "./LookupBanEntryFormatter";

/**
 * Build user lookup container using components v2 - shows ALL cross-server bans
 * for comprehensive lookup command display.
 */
export function buildUserLookupReply(
  targetUser: User,
  member: GuildMember | null,
  lookupResult: UserLookupResult,
): InteractionReplyOptions {
  const { crossServerBans, currentGuildLookupOptIn } = lookupResult;

  const container = new ContainerBuilder().setAccentColor(Color.Info);

  // User header with avatar thumbnail
  const headerSection = buildUserHeaderSection(targetUser, member);
  container.addSectionComponents(headerSection);

  container.addSeparatorComponents(new SeparatorBuilder());

  // Cross-server bans section
  const bansText = buildBansText(crossServerBans, currentGuildLookupOptIn);
  container.addTextDisplayComponents(bansText);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function buildUserHeaderSection(
  targetUser: User,
  member: GuildMember | null,
): SectionBuilder {
  const hasGlobalName =
    targetUser.globalName !== null &&
    targetUser.globalName !== targetUser.username;

  // If user has a global display name, show: DisplayName (username) — id
  // Otherwise: username — id
  const title = hasGlobalName
    ? `### ${targetUser.globalName} (\`${targetUser.username}\`) — \`${targetUser.id}\``
    : `### ${targetUser.username} — \`${targetUser.id}\``;

  const createdTimestamp = timestampToUnixTime(targetUser.createdTimestamp);
  const parts: string[] = [
    `Created <t:${createdTimestamp}:f> (<t:${createdTimestamp}:R>)`,
  ];

  if (member?.joinedTimestamp) {
    const joinedTimestamp = timestampToUnixTime(member.joinedTimestamp);
    parts.push(`Joined <t:${joinedTimestamp}:f> (<t:${joinedTimestamp}:R>)`);
  }

  if (member?.nickname) {
    parts.push(`Nickname: ${member.nickname}`);
  }

  // Show highest role with any elevated permissions, plus total count
  if (member && member.roles.cache.size > 1) {
    const nonEveryoneRoles = member.roles.cache
      .filter((role) => role.name !== "@everyone")
      .sort((a, b) => b.position - a.position);

    const highestPermRole = nonEveryoneRoles.find(
      (role) => role.permissions.bitfield !== 0n,
    );

    if (highestPermRole) {
      const count = nonEveryoneRoles.size;
      parts.push(`${highestPermRole} (${count} role${count === 1 ? "" : "s"})`);
    }
  }

  const content = `${title}\n${parts.join("\n")}`;

  return new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(targetUser.displayAvatarURL({ size: 512 })),
    );
}

function buildBansText(
  crossServerBans: UserLookupBan[],
  currentGuildLookupOptIn: boolean,
): TextDisplayBuilder {
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

  return new TextDisplayBuilder().setContent(content);
}
