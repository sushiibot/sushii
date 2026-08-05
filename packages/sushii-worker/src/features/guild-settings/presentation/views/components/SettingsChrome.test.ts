import { describe, expect, test } from "bun:test";

import { SETTINGS_TAB_BY_CUSTOM_ID, TAB_DEFS } from "./SettingsChrome";

describe("SETTINGS_TAB_BY_CUSTOM_ID", () => {
  test("resolves every tab bar customId to its own tab", () => {
    for (const def of TAB_DEFS) {
      expect(SETTINGS_TAB_BY_CUSTOM_ID.get(def.customId)).toBe(def.tab);
    }
  });

  test("has no unknown/duplicate customId across all tab entries", () => {
    const customIds = TAB_DEFS.map((def) => def.customId);
    expect(new Set(customIds).size).toBe(customIds.length);
  });
});
