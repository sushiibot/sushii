import { describe, expect, test } from "bun:test";

import {
  buildAddAllId,
  buildAddSelectedId,
  buildReviewId,
  buildSelectId,
  buildUndoId,
  isSuggestButtonId,
  isSuggestSelectId,
  parseSuggestButtonId,
  parseSuggestSelectId,
} from "./customIds";

const CASE = "18446744073709551615";
const FP = "0a1b2c3d";
const BATCH = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

describe("suggested proof custom ids", () => {
  test("round-trip within 100 characters", () => {
    const ids = [
      buildReviewId(CASE, FP),
      buildReviewId(CASE, null),
      buildAddAllId(CASE, FP),
      buildAddSelectedId(CASE, FP),
      buildUndoId(CASE, BATCH),
    ];
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(100);
      expect(isSuggestButtonId(id)).toBe(true);
    }

    expect(parseSuggestButtonId(ids[0])).toEqual({
      kind: "review",
      caseId: CASE,
      fingerprint: FP,
    });
    expect(parseSuggestButtonId(ids[1])).toEqual({
      kind: "review",
      caseId: CASE,
      fingerprint: null,
    });
    expect(parseSuggestButtonId(ids[2])).toEqual({
      kind: "add",
      caseId: CASE,
      fingerprint: FP,
    });
    expect(parseSuggestButtonId(ids[3])).toEqual({
      kind: "add-selected",
      caseId: CASE,
      fingerprint: FP,
    });
    expect(parseSuggestButtonId(ids[4])).toEqual({
      kind: "undo",
      caseId: CASE,
      batchId: BATCH,
    });

    const select = buildSelectId(CASE, FP);
    expect(select.length).toBeLessThanOrEqual(100);
    expect(isSuggestSelectId(select)).toBe(true);
    expect(isSuggestButtonId(select)).toBe(false);
    expect(parseSuggestSelectId(select)).toEqual({
      caseId: CASE,
      fingerprint: FP,
    });
  });

  test.each([
    "proof/suggest/review/4822",
    "proof/suggest/review/4822/ZZZZZZZZ",
    "proof/suggest/add/4822/log",
    "proof/suggest/add/abc/0a1b2c3d",
    "proof/suggest/add/4822/0a1b2c3d/extra",
    "proof/suggest/undo/4822/not-a-uuid",
    "proof/suggest/undo/abc/3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
    "proof/suggest/explode/4822/0a1b2c3d",
    "modAction/suggest/add-all/4822/s7k2p",
  ])("rejects garbled id %s", (id) => {
    expect(parseSuggestButtonId(id)).toBeNull();
  });

  test("rejects garbled select ids", () => {
    expect(parseSuggestSelectId("proof/suggest/select/4822")).toBeNull();
    expect(parseSuggestSelectId("proof/suggest/select/x/0a1b2c3d")).toBeNull();
  });
});
