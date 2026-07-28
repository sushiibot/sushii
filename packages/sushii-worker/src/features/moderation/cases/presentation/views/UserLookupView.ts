import type {
  ActionRowBuilder,
  ButtonBuilder,
  GuildMember,
  User,
} from "discord.js";
import {
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

import type { UserLookupBan } from "@/features/moderation/cases/domain/entities/UserLookupBan";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import { chunkItems } from "@/shared/presentation/packLines";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

import { formatBanEntry } from "./LookupBanEntryFormatter";

/**
 * Bin-pack cross-server bans into pages. Bans are expected to already be
 * ordered largest-server-first by the caller (LookupUserService sorts them);
 * chunking preserves that order within and across pages.
 */
export function buildUserLookupPages(
  crossServerBans: UserLookupBan[],
  currentGuildLookupOptIn: boolean,
): UserLookupBan[][] {
  return chunkItems(crossServerBans, (ban) =>
    formatBanEntry(ban, currentGuildLookupOptIn),
  );
}

/**
 * Build one page of the user lookup container using components v2.
 */
export function buildUserLookupPageContainer(
  targetUser: User,
  member: GuildMember | null,
  totalBans: number,
  pageBans: UserLookupBan[],
  currentGuildLookupOptIn: boolean,
  navButtons: ActionRowBuilder<ButtonBuilder> | null,
  isDisabled: boolean,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  const headerSection = buildUserHeaderSection(targetUser, member);
  container.addSectionComponents(headerSection);

  container.addSeparatorComponents(new SeparatorBuilder());

  const bansText = buildBansText(
    pageBans,
    totalBans,
    currentGuildLookupOptIn,
  );
  container.addTextDisplayComponents(bansText);

  ComponentsV2Paginator.addNavigationSection(container, navButtons, isDisabled);

  return container;
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
  const parts: string[] = [`Created <t:${createdTimestamp}:R>`];

  if (member?.joinedTimestamp) {
    const joinedTimestamp = timestampToUnixTime(member.joinedTimestamp);
    parts.push(`Joined <t:${joinedTimestamp}:R>`);
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
  pageBans: UserLookupBan[],
  totalBans: number,
  currentGuildLookupOptIn: boolean,
): TextDisplayBuilder {
  if (totalBans === 0) {
    // Opt-in only withholds names/reasons on entries that exist, never the
    // entries themselves, so zero here always means zero, not "hidden".
    const content =
      "**No cross-server bans found.**\n" +
      "-# Includes bans from servers that haven't opted into sharing details.";

    return new TextDisplayBuilder().setContent(content);
  }

  const scopeLine = `-# ${totalBans} ban${totalBans === 1 ? "" : "s"}, largest servers first`;
  const entries = pageBans
    .map((ban) => formatBanEntry(ban, currentGuildLookupOptIn))
    .join("\n");

  return new TextDisplayBuilder().setContent(`${scopeLine}\n${entries}`);
}
