import { describe, expect, test } from "bun:test";

import {
  PAGE_INFO_ID,
  buildAddId,
  buildPageId,
  buildTemplateActionId,
  matchPanelCustomId,
  parsePanelId,
} from "./customIds";
import { matchTemplateEditCustomId } from "./templateSavedMessage";

describe("panel custom IDs", () => {
  test("round trip", () => {
    expect(parsePanelId(buildAddId())).toEqual({ action: "add" });
    expect(parsePanelId(buildPageId(3))).toEqual({ action: "page", page: 3 });
    for (const action of [
      "manage",
      "edit",
      "delete",
      "deleteConfirm",
    ] as const) {
      expect(parsePanelId(buildTemplateActionId(action, "42", 2))).toEqual({
        action,
        templateId: "42",
        page: 2,
      });
    }
  });

  test("don't claim the template saved Edit button or other IDs", () => {
    for (const id of [
      "reasonTemplates:edit:16",
      PAGE_INFO_ID,
      "reasonTemplates/manage/abc/1",
      "reasonTemplates/edit/11",
      "reasonTemplates/addModal/abcd1234",
      "reasonTemplate/save/4822",
      "modLogReason/4822",
    ]) {
      expect(matchPanelCustomId(id)).toBe(false);
    }

    expect(
      matchTemplateEditCustomId(buildTemplateActionId("edit", "11", 1)),
    ).toBe(false);
  });

  test("stay under Discord's 100 character limit", () => {
    expect(
      buildTemplateActionId("deleteConfirm", "9".repeat(19), 9999).length,
    ).toBeLessThanOrEqual(100);
  });
});
