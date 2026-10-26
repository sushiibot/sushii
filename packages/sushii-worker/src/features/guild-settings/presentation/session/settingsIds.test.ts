import { describe, expect, test } from "bun:test";

import {
  SETTINGS_EDIT_TARGETS,
  SETTINGS_TABS,
  SETTINGS_TOGGLE_TARGETS,
  isSettingsId,
  parseSettingsId,
  settingsIds,
} from "./settingsIds";

describe("settingsIds", () => {
  test.each([...SETTINGS_TABS])("tab %s round-trips", (tab) => {
    const id = settingsIds.tab(tab);

    expect(id).toBe(`settings:tab:${tab}`);
    expect(parseSettingsId(id)).toEqual({ kind: "tab", tab });
  });

  test.each([...SETTINGS_EDIT_TARGETS])("edit %s round-trips", (target) => {
    const id = settingsIds.edit(target);

    expect(id).toBe(`settings:edit:${target}`);
    expect(parseSettingsId(id)).toEqual({ kind: "edit", target });
  });

  test.each([...SETTINGS_TOGGLE_TARGETS])("toggle %s round-trips", (target) => {
    const id = settingsIds.toggle(target);

    expect(id).toBe(`settings:toggle:${target}`);
    expect(parseSettingsId(id)).toEqual({ kind: "toggle", target });
  });

  test.each([...SETTINGS_EDIT_TARGETS])("modal %s round-trips", (target) => {
    const id = settingsIds.modal(target);

    expect(id).toMatch(new RegExp(`^settings:modal:${target}:[0-9a-z]{8}$`));
    const parsed = parseSettingsId(id);
    expect(parsed).toEqual({
      kind: "modal",
      target,
      nonce: id.split(":")[3],
    });
  });

  test("every modal() call returns a new ID", () => {
    const ids = new Set(
      Array.from({ length: 100 }, () => settingsIds.modal("join")),
    );

    expect(ids.size).toBe(100);
  });

  test.each([
    "",
    "settings",
    "settings:",
    "settings:tab",
    "settings:tab:",
    "settings:tab:unknown",
    "settings:edit:lookup",
    "settings:toggle:modlog",
    "settings:unknown:modlog",
    "settings:tab:overview:extra",
    "settings:edit:modlog:abcd1234",
    "settings:modal:join",
    "settings:modal:join:",
    "settings:modal:join:short",
    "settings:modal:join:ABCD1234",
    "settings:modal:join:abcd1234:extra",
    "settings:modal:unknown:abcd1234",
    "other:tab:overview",
    "Settings:tab:overview",
  ])("parseSettingsId(%p) returns null", (id) => {
    expect(parseSettingsId(id)).toBeNull();
  });

  test("isSettingsId checks the prefix", () => {
    expect(isSettingsId(settingsIds.tab("overview"))).toBe(true);
    expect(isSettingsId(settingsIds.modal("join"))).toBe(true);
    expect(isSettingsId("settings:anything")).toBe(true);
    expect(isSettingsId("settings")).toBe(false);
    expect(isSettingsId("settingsx:tab:overview")).toBe(false);
    expect(isSettingsId("giveaway:enter")).toBe(false);
  });
});
