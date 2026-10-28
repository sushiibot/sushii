import { describe, expect, test } from "bun:test";

import { CaseRange } from "@/features/moderation/shared/domain/value-objects/CaseRange";

import {
  ENCODED_CASES_MAX_LENGTH,
  buildResponseButtonId,
  decodeCaseIds,
  encodeCaseIds,
  matchResponseButtonId,
  parseResponseButtonId,
  toCaseRuns,
} from "./customIds";

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error("expected a value");
  }
  return value;
}

describe("case ID encoding", () => {
  test("compresses consecutive cases and keeps gaps", () => {
    expect(encodeCaseIds(["4830", "4822", "4823"])).toBe("4822-4823,4830");
    expect(encodeCaseIds(["4822"])).toBe("4822");
    expect(toCaseRuns(["1", "2", "3", "5", "7", "8"])).toEqual([
      "1-3",
      "5",
      "7-8",
    ]);
  });

  test("round-trips", () => {
    const ids = ["4822", "4823", "4830", "4900", "4901", "4902"];
    expect(decodeCaseIds(must(encodeCaseIds(ids)))).toEqual(ids);
  });

  test("every button's custom ID fits in 100 characters, or none is built", () => {
    const spread = Array.from({ length: 25 }, (_, i) => `${100000 + i * 2}`);
    expect(encodeCaseIds(spread)).toBeNull();

    const fits = Array.from({ length: 12 }, (_, i) => `${1000 + i * 2}`);
    const encoded = must(encodeCaseIds(fits));
    expect(encoded.length).toBeLessThanOrEqual(ENCODED_CASES_MAX_LENGTH);
    for (const kind of [
      "edit",
      "dmDelete",
      "dmDeleteConfirm",
      "dmCancel",
      "save",
    ] as const) {
      expect(buildResponseButtonId(kind, encoded).length).toBeLessThanOrEqual(
        100,
      );
    }
  });

  test("rejects malformed or oversized ranges", () => {
    expect(decodeCaseIds("")).toBeNull();
    expect(decodeCaseIds("4823-4822")).toBeNull();
    expect(decodeCaseIds("1-100")).toBeNull();
    expect(decodeCaseIds("abc")).toBeNull();
    expect(decodeCaseIds("0")).toBeNull();
    expect(decodeCaseIds("1,,2")).toBeNull();
  });
});

describe("runs and the reason update range parser", () => {
  test("every run parses to exactly its own cases", async () => {
    const runs = toCaseRuns(["4822", "4823", "4830"]);
    const resolved = await Promise.all(
      runs.map((run) =>
        CaseRange.fromString(run)
          .unwrap()
          .resolveToRange(async () => 1),
      ),
    );
    expect(resolved.map((r) => r.unwrap())).toEqual([
      [4822, 4823],
      [4830, 4830],
    ]);
  });
});

describe("response button IDs", () => {
  test("parse every kind", () => {
    expect(parseResponseButtonId("modAction/reason/edit/4822-4823")).toEqual({
      kind: "edit",
      caseIds: ["4822", "4823"],
    });
    expect(parseResponseButtonId("modAction/dm/delete/4822")?.kind).toBe(
      "dmDelete",
    );
    expect(parseResponseButtonId("modAction/dm/deleteConfirm/4822")?.kind).toBe(
      "dmDeleteConfirm",
    );
    expect(parseResponseButtonId("modAction/dm/cancel/4822")?.kind).toBe(
      "dmCancel",
    );
    expect(parseResponseButtonId("modAction/save/4822,4830")).toEqual({
      kind: "save",
      caseIds: ["4822", "4830"],
    });
  });

  test("leave other custom IDs alone", () => {
    expect(matchResponseButtonId("modLog/dm/delete/4822")).toBe(false);
    expect(matchResponseButtonId("modAction/reasonForm/123")).toBe(false);
    expect(matchResponseButtonId("modAction/dm/delete/")).toBe(false);
    expect(matchResponseButtonId("modAction/dm/delete/4822")).not.toBe(false);
  });
});
