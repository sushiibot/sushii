import { describe, expect, test } from "bun:test";

import {
  TAB_CONTENT_CHAR_BUDGET,
  chunkItems,
  packItems,
  packMentions,
} from "./packLines";

interface Entry {
  id: number;
  reason: string;
}

const entries: Entry[] = [
  { id: 1, reason: "spam" },
  { id: 2, reason: "raid" },
  { id: 3, reason: "harassment" },
  { id: 4, reason: "scam link" },
];

function renderEntry(entry: Entry): string {
  return `Case #${entry.id}\n> ${entry.reason}`;
}

describe("packItems", () => {
  test("keeps whole entries, never splitting an entry from its continuation line", () => {
    const { text } = packItems(entries, renderEntry, 50);

    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (lines[i].startsWith(">")) {
        expect(lines[i - 1].startsWith("Case #")).toBe(true);
      }
    }
  });

  test("shows every entry when nothing needs to be dropped", () => {
    const result = packItems(entries, renderEntry, TAB_CONTENT_CHAR_BUDGET);

    expect(result.shown).toBe(entries.length);
  });

  test("drops the tail once the budget is exceeded", () => {
    const result = packItems(entries, renderEntry, 50);

    expect(result.shown).toBeLessThan(entries.length);
  });

  test("packItems fills exactly to the budget boundary", () => {
    const r = packItems(entries, renderEntry, 50);
    expect(r.shown).toBe(3);
    expect(r.text.length).toBe(50);

    expect(packItems(entries, renderEntry, 49).shown).toBe(2);
  });

  test("defaults to TAB_CONTENT_CHAR_BUDGET when no budget is given", () => {
    const withDefault = packItems(entries, renderEntry);
    const withExplicitBudget = packItems(
      entries,
      renderEntry,
      TAB_CONTENT_CHAR_BUDGET,
    );

    expect(withDefault).toEqual(withExplicitBudget);
  });

  test("still emits an oversized single entry rather than looping forever", () => {
    const huge: Entry = { id: 99, reason: "x".repeat(200) };

    const result = packItems([huge], renderEntry, 50);

    expect(result.shown).toBe(1);
    expect(result.text).toBe(renderEntry(huge));
  });
});

describe("packMentions", () => {
  const mentions = ["<@1>", "<@2>", "<@3>", "<@4>"];

  test("joins mentions with a comma and space", () => {
    const result = packMentions(mentions, (m) => m, TAB_CONTENT_CHAR_BUDGET);

    expect(result.text).toBe("<@1>, <@2>, <@3>, <@4>");
    expect(result.shownCount).toBe(mentions.length);
  });

  test("drops trailing mentions once the budget is exceeded", () => {
    // "<@1>, <@2>" is 10 chars; a budget of 10 leaves no room for a third.
    const result = packMentions(mentions, (m) => m, 10);

    expect(result.text).toBe("<@1>, <@2>");
    expect(result.shownCount).toBe(2);
  });

  test("still emits an oversized first mention rather than an empty result", () => {
    const huge = ["<@" + "1".repeat(200) + ">", "<@2>"];

    const result = packMentions(huge, (m) => m, 10);

    expect(result.shownCount).toBe(1);
    expect(result.text).toBe(huge[0]);
  });
});

describe("chunkItems", () => {
  test("drops nothing: concatenating all chunks round-trips the input array", () => {
    const chunks = chunkItems(entries, renderEntry, 50);

    const flattened = chunks.flat();
    expect(flattened).toEqual(entries);
  });

  test("never splits an entry from its continuation line across a chunk boundary", () => {
    const chunks = chunkItems(entries, renderEntry, 50);

    for (const chunk of chunks) {
      const text = chunk.map(renderEntry).join("\n");
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].startsWith(">")) {
          expect(lines[i - 1].startsWith("Case #")).toBe(true);
        }
      }
    }
  });

  test("returns a single chunk when everything fits under the default budget", () => {
    const chunks = chunkItems(entries, renderEntry);

    expect(chunks).toEqual([entries]);
  });

  test("gives an oversized single entry its own bin rather than looping forever", () => {
    const huge: Entry = { id: 99, reason: "x".repeat(200) };

    const chunks = chunkItems([entries[0], huge, entries[1]], renderEntry, 50);

    expect(chunks.flat()).toEqual([entries[0], huge, entries[1]]);
    expect(
      chunks.some((chunk) => chunk.length === 1 && chunk[0] === huge),
    ).toBe(true);
  });

  test("returns no items for an empty input", () => {
    expect(chunkItems([], renderEntry, 50)).toEqual([]);
  });

  test("every chunk's joined text fits the budget", () => {
    for (const budget of [49, 50, 51, 60, 34]) {
      for (const chunk of chunkItems(entries, renderEntry, budget)) {
        expect(chunk.map(renderEntry).join("\n").length).toBeLessThanOrEqual(
          budget,
        );
      }
    }
  });

  test("exact chunk shape at budget 50 (three entries join to exactly 50)", () => {
    expect(chunkItems(entries, renderEntry, 50)).toEqual([
      [entries[0], entries[1], entries[2]],
      [entries[3]],
    ]);
  });

  test("exact chunk shape at budget 49 (one char short)", () => {
    expect(chunkItems(entries, renderEntry, 49)).toEqual([
      [entries[0], entries[1]],
      [entries[2], entries[3]],
    ]);
  });
});
