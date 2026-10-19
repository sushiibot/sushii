import { describe, expect, test } from "bun:test";

import {
  computeRoleMenuSelectionChanges,
  findRolesNotInMenu,
} from "./roleMenuSelection";

describe("computeRoleMenuSelectionChanges", () => {
  const menuRoleIds = ["a", "b", "c"];

  test("adds newly selected roles and removes deselected menu roles", () => {
    const changes = computeRoleMenuSelectionChanges({
      currentRoleIds: ["a", "other"],
      selectedRoleIds: ["b"],
      menuRoleIds,
    });

    expect(changes).toEqual({ toAdd: ["b"], toRemove: ["a"] });
  });

  test("never touches roles outside the menu", () => {
    const changes = computeRoleMenuSelectionChanges({
      currentRoleIds: ["other", "a"],
      selectedRoleIds: [],
      menuRoleIds,
    });

    expect(changes).toEqual({ toAdd: [], toRemove: ["a"] });
  });

  test("ignores selected roles that are not in the menu", () => {
    const changes = computeRoleMenuSelectionChanges({
      currentRoleIds: [],
      selectedRoleIds: ["a", "not-in-menu"],
      menuRoleIds,
    });

    expect(changes).toEqual({ toAdd: ["a"], toRemove: [] });
  });

  test("no changes when selection matches current roles", () => {
    const changes = computeRoleMenuSelectionChanges({
      currentRoleIds: ["a", "c"],
      selectedRoleIds: ["c", "a"],
      menuRoleIds,
    });

    expect(changes).toEqual({ toAdd: [], toRemove: [] });
  });

  test("deduplicates repeated selections", () => {
    const changes = computeRoleMenuSelectionChanges({
      currentRoleIds: [],
      selectedRoleIds: ["a", "a"],
      menuRoleIds,
    });

    expect(changes).toEqual({ toAdd: ["a"], toRemove: [] });
  });
});

describe("findRolesNotInMenu", () => {
  test("returns roles not present in the menu", () => {
    expect(findRolesNotInMenu(["a", "x", "y"], ["a", "b"])).toEqual(["x", "y"]);
  });

  test("returns empty when all roles are in the menu", () => {
    expect(findRolesNotInMenu(["a"], ["a", "b"])).toEqual([]);
  });
});
