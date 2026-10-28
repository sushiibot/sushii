import { describe, expect, test } from "bun:test";
import type { APILabelComponent, APITextInputComponent } from "discord.js";
import { TextInputStyle } from "discord.js";

import type { ReasonTemplate } from "../../domain/ReasonTemplate";
import { parsePanelId } from "../customIds";
import { buildModalId } from "../customIds";
import {
  buildSaveTemplateModal,
  buildTemplateFormModal,
  readTemplateFields,
} from "./reasonTemplateModals";

const SPAM: ReasonTemplate = {
  id: "11",
  guildId: "1029384756102938475",
  shortcut: "spam",
  content: "Spamming in channels (rule 3).",
  contentKey: "key",
  createdBy: "238381427315195904",
  createdAt: new Date("2026-09-17T12:00:00Z"),
  updatedAt: null,
  useCount: 0,
  lastUsedAt: null,
};

function labels(modal: { toJSON(): { components: unknown[] } }) {
  return modal.toJSON().components as (APILabelComponent & {
    component: APITextInputComponent;
  })[];
}

describe("buildTemplateFormModal", () => {
  test("add form", () => {
    const modal = buildTemplateFormModal(buildModalId("addModal"), null);
    const json = modal.toJSON();
    const [shortcut, reason] = labels(modal);

    expect(json.title).toBe("Add template");
    expect(shortcut).toMatchObject({
      label: "Shortcut",
      description:
        "Optional. Type it with ! at the start of a reason, like !spam.",
      component: {
        custom_id: "shortcut",
        style: TextInputStyle.Short,
        required: false,
        max_length: 32,
        placeholder: "e.g. spam",
      },
    });
    expect(shortcut.component.value).toBeUndefined();
    expect(reason).toMatchObject({
      label: "Reason",
      component: {
        custom_id: "content",
        style: TextInputStyle.Paragraph,
        required: true,
        max_length: 3000,
      },
    });
    expect(reason.component.value).toBeUndefined();
  });

  test("edit form is prefilled", () => {
    const modal = buildTemplateFormModal(buildModalId("editModal"), SPAM);
    const [shortcut, reason] = labels(modal);

    expect(modal.toJSON().title).toBe("Edit template");
    expect(shortcut.component.value).toBe("spam");
    expect(reason.component.value).toBe(SPAM.content);
  });
});

describe("buildSaveTemplateModal", () => {
  test("prefills the text and leaves the shortcut empty", () => {
    const modal = buildSaveTemplateModal(
      buildModalId("saveModal"),
      "Arguing with mods.",
    );
    const [content, shortcut] = labels(modal);

    expect(modal.toJSON().title).toBe("Save as template");
    expect(content).toMatchObject({
      label: "Template text",
      component: { custom_id: "content", required: true, max_length: 3000 },
    });
    expect(content.component.value).toBe("Arguing with mods.");
    expect(shortcut).toMatchObject({
      label: "Shortcut",
      description:
        "Optional. Type !modmail at the start of a reason to use it.",
      component: { required: false, placeholder: "e.g. modmail" },
    });
    expect(shortcut.component.value).toBeUndefined();
  });

  test("blank prefill leaves the text empty", () => {
    const [content] = labels(
      buildSaveTemplateModal(buildModalId("saveModal"), "  "),
    );

    expect(content.component.value).toBeUndefined();
  });
});

describe("modal custom IDs", () => {
  test("are unique per open and never match panel buttons", () => {
    const a = buildModalId("editModal");
    const b = buildModalId("editModal");

    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(100);
    expect(parsePanelId(a)).toBeNull();
  });
});

describe("readTemplateFields", () => {
  test("blank shortcut becomes null", () => {
    const values: Record<string, string> = { shortcut: "  ", content: "x" };

    expect(
      readTemplateFields({ getTextInputValue: (id: string) => values[id] }),
    ).toEqual({ content: "x", shortcut: null });
  });

  test("keeps a typed shortcut for the service to normalize", () => {
    const values: Record<string, string> = {
      shortcut: " !Spam ",
      content: "x",
    };

    expect(
      readTemplateFields({ getTextInputValue: (id: string) => values[id] }),
    ).toEqual({ content: "x", shortcut: "!Spam" });
  });
});
