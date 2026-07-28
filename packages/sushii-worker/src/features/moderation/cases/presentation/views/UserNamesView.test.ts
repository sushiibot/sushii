import { describe, expect, it } from "bun:test";

import type { UserNameHistoryEntry } from "@/features/user-name-history";

import { buildNameGroupLines, formatNameValue } from "./UserNamesView";

let nextId = 1;

function makeEntry(
  value: string | null,
  recordedAt: Date,
  overrides: Partial<UserNameHistoryEntry> = {},
): UserNameHistoryEntry {
  return {
    id: nextId++,
    userId: 111111111111111111n,
    nameType: "nickname",
    guildId: 222222222222222222n,
    value,
    recordedAt,
    ...overrides,
  } as UserNameHistoryEntry;
}

const OLDEST = new Date("2024-01-01T00:00:00.000Z");
const NEWEST = new Date("2024-12-01T00:00:00.000Z");

describe("buildNameGroupLines", () => {
  it("marks only the newest row as current when multiple recorded rows share the live null value", () => {
    // Member set a nickname twice and cleared it both times — two rows have
    // value === null, and the live nickname is also null. Only the newest
    // (first, since entries arrive newest-first) should be "current".
    const entries = [makeEntry(null, NEWEST), makeEntry(null, OLDEST)];

    const { entryLines } = buildNameGroupLines(
      "Nickname (this server)",
      entries,
      formatNameValue,
      null,
    );

    const currentRows = entryLines.filter((line) => line.includes("current"));
    expect(currentRows).toHaveLength(1);
    expect(entryLines[0]).toContain("current");
    expect(entryLines[1]).not.toContain("current");
  });

  it("marks the recorded row matching the live value as current", () => {
    const entries = [
      makeEntry("Newname", NEWEST),
      makeEntry("Oldname", OLDEST),
    ];

    const { entryLines } = buildNameGroupLines(
      "Nickname (this server)",
      entries,
      formatNameValue,
      "Newname",
    );

    expect(entryLines[0]).toContain("current");
    expect(entryLines[1]).not.toContain("current");
  });

  it("synthesizes the unobserved live value as the top row when no recorded entry matches", () => {
    const entries = [makeEntry("Oldname", OLDEST)];

    const { entryLines } = buildNameGroupLines(
      "Nickname (this server)",
      entries,
      formatNameValue,
      "Livename",
    );

    expect(entryLines).toHaveLength(2);
    expect(entryLines[0]).toBe("`Livename` · current");
    expect(entryLines[1]).not.toContain("current");
  });

  it("does not synthesize a row when a recorded entry already matches the live value", () => {
    const entries = [makeEntry("Livename", NEWEST)];

    const { entryLines } = buildNameGroupLines(
      "Nickname (this server)",
      entries,
      formatNameValue,
      "Livename",
    );

    expect(entryLines).toHaveLength(1);
    expect(entryLines[0]).toContain("current");
  });

  it("keeps the label count equal to the number of rendered rows, including a synthesized row", () => {
    const entries = [makeEntry("Oldname", OLDEST)];

    const { labelLine, entryLines } = buildNameGroupLines(
      "Nickname (this server)",
      entries,
      formatNameValue,
      "Livename",
    );

    expect(entryLines).toHaveLength(2);
    expect(labelLine).toBe("**Nickname (this server)** · 2");
  });

  it("renders (removed) for a cleared value instead of blank", () => {
    const entries = [makeEntry(null, NEWEST)];

    const { entryLines } = buildNameGroupLines(
      "Nickname (this server)",
      entries,
      formatNameValue,
      null,
    );

    expect(entryLines[0]).toStartWith("(removed)");
    expect(entryLines[0]).not.toBe("");
  });

  it("renders the label line ending in a bare integer for each group label", () => {
    for (const label of [
      "Username",
      "Display Name",
      "Nickname (this server)",
    ]) {
      const entries = [makeEntry("value", NEWEST)];
      const { labelLine } = buildNameGroupLines(
        label,
        entries,
        formatNameValue,
        "value",
      );

      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(labelLine).toMatch(
        new RegExp(`^\\*\\*${escapedLabel}\\*\\* · \\d+$`),
      );
    }
  });
});
