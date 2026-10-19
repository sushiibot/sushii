import { describe, expect, it } from "bun:test";

import { computeLevelRoleDiff } from "./levelRoleDiff";

describe("computeLevelRoleDiff", () => {
  it("adds only roles the member does not already have", () => {
    const diff = computeLevelRoleDiff(["a", "b"], ["b", "c"], null);

    expect(diff).toEqual({ toAdd: ["c"], toRemove: [] });
  });

  it("removes only roles the member currently has", () => {
    const diff = computeLevelRoleDiff(["a", "b"], null, ["b", "x"]);

    expect(diff).toEqual({ toAdd: [], toRemove: ["b"] });
  });

  it("never touches roles outside the add/remove lists", () => {
    const diff = computeLevelRoleDiff(["other1", "other2"], ["lvl"], ["old"]);

    expect(diff.toAdd).toEqual(["lvl"]);
    expect(diff.toRemove).toEqual([]);
  });

  it("does not add a role that is also being removed", () => {
    const diff = computeLevelRoleDiff([], ["r"], ["r"]);

    expect(diff).toEqual({ toAdd: [], toRemove: [] });
  });

  it("deduplicates role IDs", () => {
    const diff = computeLevelRoleDiff(["x"], ["a", "a"], ["x", "x"]);

    expect(diff).toEqual({ toAdd: ["a"], toRemove: ["x"] });
  });

  it("returns empty lists when there is nothing to change", () => {
    expect(computeLevelRoleDiff(["a"], null, null)).toEqual({
      toAdd: [],
      toRemove: [],
    });
  });
});
