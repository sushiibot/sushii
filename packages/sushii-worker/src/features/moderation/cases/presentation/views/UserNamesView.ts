import type { GuildMember, InteractionReplyOptions, User } from "discord.js";
import {
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
} from "discord.js";

import type { NamesResult } from "@/features/moderation/cases/application/NamesUserService";
import type { UserNameHistoryEntry } from "@/features/user-name-history";
import Color from "@/utils/colors";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

export interface NameHistoryGroups {
  usernameEntries: UserNameHistoryEntry[];
  globalNameEntries: UserNameHistoryEntry[];
  nicknameEntries: UserNameHistoryEntry[];
}

export function groupNameHistory(
  result: NamesResult,
  guildId: string,
): NameHistoryGroups {
  return {
    usernameEntries: result.history.filter((e) => e.nameType === "username"),
    globalNameEntries: result.history.filter(
      (e) => e.nameType === "global_name",
    ),
    nicknameEntries: result.history.filter(
      (e) => e.nameType === "nickname" && e.guildId?.toString() === guildId,
    ),
  };
}

export function buildUserNamesReply(
  targetUser: User,
  member: GuildMember | null,
  result: NamesResult,
  guildId: string,
): InteractionReplyOptions {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  container.addSectionComponents(buildUserHeaderSection(targetUser, member));
  container.addSeparatorComponents(new SeparatorBuilder());

  const { usernameEntries, globalNameEntries, nicknameEntries } =
    groupNameHistory(result, guildId);

  // A group with zero recorded entries can still have a row to show — a
  // synthesized "current value, not recorded" row — so gate on the built
  // section rather than on `entries.length`.
  const sections = [
    buildHistorySection(
      "Username",
      usernameEntries,
      formatUsernameValue,
      targetUser.username,
    ),
    buildHistorySection(
      "Display Name",
      globalNameEntries,
      formatNameValue,
      targetUser.globalName,
    ),
    buildHistorySection(
      "Nickname (this server)",
      nicknameEntries,
      formatNameValue,
      member?.nickname,
    ),
  ].filter((section): section is TextDisplayBuilder => section !== null);

  if (sections.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "**No name history recorded**\n-# Name history accumulates from changes observed after tracking began.",
      ),
    );
  } else {
    for (const section of sections) {
      container.addTextDisplayComponents(section);
    }
  }

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

  const title = hasGlobalName
    ? `### ${targetUser.globalName} (\`${targetUser.username}\`) — \`${targetUser.id}\``
    : `### ${targetUser.username} — \`${targetUser.id}\``;

  const createdTimestamp = timestampToUnixTime(targetUser.createdTimestamp);
  const parts: string[] = [`Created <t:${createdTimestamp}:R>`];

  if (member?.joinedTimestamp) {
    const joinedTimestamp = timestampToUnixTime(member.joinedTimestamp);
    parts.push(`Joined <t:${joinedTimestamp}:R>`);
  }

  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${title}\n${parts.join("\n")}`),
    )
    .setThumbnailAccessory(
      new ThumbnailBuilder().setURL(targetUser.displayAvatarURL({ size: 512 })),
    );
}

export function formatUsernameValue(value: string): string {
  return `\`@${value}\``;
}

export function formatNameValue(value: string): string {
  return `\`${value}\``;
}

interface NameRow {
  display: string;
  // Null only for the synthesized "unobserved live value" row — we never
  // witnessed the change, so there is no true timestamp to render.
  recordedAt: Date | null;
  isCurrent: boolean;
}

export interface NameGroupLines {
  labelLine: string;
  entryLines: string[];
}

/**
 * Builds the `**Label** · N` label line and one entry line per row for a
 * name-type group. Shared by the `/names` reply and the mod view Names tab
 * so both surfaces render identically.
 */
export function buildNameGroupLines(
  label: string,
  entries: UserNameHistoryEntry[],
  formatDisplay: (value: string) => string,
  currentValue: string | null | undefined,
): NameGroupLines {
  const rows = buildRows(entries, formatDisplay, currentValue);

  const entryLines = rows.map((row) => {
    const current = row.isCurrent ? " · current" : "";

    if (row.recordedAt === null) {
      return `${row.display}${current} · not recorded`;
    }

    const ts = timestampToUnixTime(row.recordedAt.getTime());
    return `${row.display}${current} · <t:${ts}:R>`;
  });

  return { labelLine: `**${label}** · ${rows.length}`, entryLines };
}

function buildHistorySection(
  label: string,
  entries: UserNameHistoryEntry[],
  formatDisplay: (value: string) => string,
  currentValue: string | null | undefined,
): TextDisplayBuilder | null {
  const { labelLine, entryLines } = buildNameGroupLines(
    label,
    entries,
    formatDisplay,
    currentValue,
  );

  if (entryLines.length === 0) {
    return null;
  }

  return new TextDisplayBuilder().setContent(
    `${labelLine}\n${entryLines.join("\n")}`,
  );
}

function buildRows(
  entries: UserNameHistoryEntry[],
  formatDisplay: (value: string) => string,
  currentValue: string | null | undefined,
): NameRow[] {
  // `currentValue` is nullable (a cleared nickname/display name reads as
  // null), and so is `entry.value` (a removed name). Comparing them directly
  // would mark every removed row as current once the live value is also
  // null, so only the first (newest, since entries are newest-first) match
  // is ever marked current.
  let matched = false;
  const rows: NameRow[] = entries.map((entry) => {
    const isCurrent = !matched && entry.value === currentValue;
    if (isCurrent) {
      matched = true;
    }

    return {
      display: entry.value ? formatDisplay(entry.value) : "(removed)",
      recordedAt: entry.recordedAt,
      isCurrent,
    };
  });

  // Entries are newest-first, so an unobserved live value is inserted at the
  // top. Its timestamp is left null rather than fabricated — we never
  // recorded when this change happened, only that the live value differs
  // from every recorded row, so stamping it with the render time would
  // falsely read as "changed just now". Only a truthy `currentValue`
  // synthesizes a row: a null current value with no matching removed row
  // just means the field was never set and never tracked, which isn't
  // information worth surfacing.
  if (currentValue && !matched) {
    rows.unshift({
      display: formatDisplay(currentValue),
      recordedAt: null,
      isCurrent: true,
    });
  }

  return rows;
}
