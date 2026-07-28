import type { NamesResult } from "@/features/moderation/cases/application/NamesUserService";
import type { UserNameHistoryEntry } from "@/features/user-name-history";
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

/**
 * Count of actually-recorded name changes, scoped to `guildId` for
 * nicknames. Deliberately excludes `buildNameGroupLines`' synthesized
 * "unobserved live value" rows — those aren't a change anyone witnessed, so
 * counting them would let a user with zero history still read as having
 * changes. Shared so every surface that states "N name changes" (the Names
 * tab's own scope block, Overview's summary row) agrees.
 */
export function countRecordedNameChanges(groups: NameHistoryGroups): number {
  return (
    groups.usernameEntries.length +
    groups.globalNameEntries.length +
    groups.nicknameEntries.length
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
  // False when every row is the synthesized "unobserved live value" row
  // (`recordedAt === null`) — callers use this to tell a group that has
  // genuine history from one that only has a live value to show.
  hasRecordedRow: boolean;
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

    // The synthesized live-value row (see `buildRows`) always has both
    // `recordedAt === null` and `isCurrent === true` — "current" already
    // says what this is, so no separate "not recorded" marker is needed.
    if (row.recordedAt === null) {
      return `${row.display}${current}`;
    }

    const ts = timestampToUnixTime(row.recordedAt.getTime());
    return `${row.display}${current} · <t:${ts}:R>`;
  });

  return {
    labelLine: `**${label}** · ${rows.length}`,
    entryLines,
    hasRecordedRow: rows.some((row) => row.recordedAt !== null),
  };
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
