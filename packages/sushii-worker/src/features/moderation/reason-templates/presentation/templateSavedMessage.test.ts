import { describe, expect, test } from "bun:test";
import type { APIContainerComponent } from "discord.js";
import { MessageFlags } from "discord.js";

import type MessageComponentHandler from "@/shared/presentation/handlers/MessageComponentHandler";

import type { ReasonTemplate } from "../domain/ReasonTemplate";
import {
  buildTemplateEditButtonId,
  buildTemplateSavedMessage,
  matchTemplateEditCustomId,
  parseTemplateEditButtonId,
} from "./templateSavedMessage";

const emojis = {
  success: "<:success:1400000000000000001>",
  message_edit: "<:message_edit:1400000000000000002>",
};

function template(overrides: Partial<ReasonTemplate> = {}): ReasonTemplate {
  return {
    id: "16",
    guildId: "1029384756102938475",
    shortcut: null,
    content: "Arguing with mods.\nUse modmail instead.",
    contentKey: "arguing with mods. use modmail instead.",
    createdBy: "150443906511667200",
    createdAt: new Date("2026-10-27T12:00:00Z"),
    updatedAt: null,
    useCount: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

function render(t: ReasonTemplate, fromCheckbox: boolean) {
  const message = buildTemplateSavedMessage(t, emojis, { fromCheckbox });
  const container = (
    message.components as { toJSON(): APIContainerComponent }[]
  )[0].toJSON();
  return { message, container };
}

describe("buildTemplateSavedMessage", () => {
  test("quotes every line of the template without quoting the hint", () => {
    const { container } = render(template(), false);
    const text = container.components[0];
    expect(text).toMatchObject({ type: 10 });
    const content = (text as { content: string }).content;
    expect(content).toContain(
      "> Arguing with mods.\n> Use modmail instead.\n-# ",
    );
    expect(content).not.toContain(">>>");
  });

  test("a missing emoji leaves Edit template without one", () => {
    const message = buildTemplateSavedMessage(
      template(),
      { success: "", message_edit: "" },
      { fromCheckbox: true },
    );
    const json = JSON.stringify(
      (
        message.components as { toJSON(): APIContainerComponent }[]
      )[0]?.toJSON(),
    );

    expect(json).toContain('"label":"Edit template"');
    expect(json).not.toContain('"emoji"');
    expect(json).toContain("### Template saved");
  });

  test("shortcut hint names the shortcut", () => {
    const { container } = render(template({ shortcut: "modmail" }), false);
    expect(JSON.stringify(container)).toContain("Type `!modmail`");
  });

  test("no shortcut from the save form points at /reason-templates", () => {
    const { container } = render(template(), false);
    expect(JSON.stringify(container)).toContain("/reason-templates");
    expect(container.components).toHaveLength(1);
  });

  test("from a checkbox adds an Edit template button", () => {
    const { message, container } = render(template(), true);
    expect(message.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    const row = container.components[1] as {
      components: { custom_id: string; label: string }[];
    };
    expect(row.components[0]).toMatchObject({
      custom_id: "reasonTemplates:edit:16",
      label: "Edit template",
    });
  });
});

describe("long templates", () => {
  test("text display stays within 4000 chars", () => {
    const { container } = render(
      template({ content: "line\n".repeat(1000) }),
      false,
    );
    const content = (container.components[0] as { content: string }).content;

    expect(content.length).toBeLessThanOrEqual(4000);
    expect(content).toContain("…\n-# ");
  });
});

describe("template edit button id", () => {
  test("fits MessageComponentHandler.customIDMatch", () => {
    const customIDMatch: MessageComponentHandler["customIDMatch"] =
      matchTemplateEditCustomId;

    expect(customIDMatch("reasonTemplates:edit:7")).not.toBe(false);
  });

  test("round trips", () => {
    expect(parseTemplateEditButtonId(buildTemplateEditButtonId("42"))).toBe(
      "42",
    );
    expect(matchTemplateEditCustomId("reasonTemplates:edit:42")).toEqual({
      path: "reasonTemplates:edit:42",
      index: 0,
      params: { templateId: "42" },
    });
  });

  test("rejects other ids", () => {
    expect(parseTemplateEditButtonId("reasonTemplates:edit:abc")).toBeNull();
    expect(matchTemplateEditCustomId("modLogReason/4822")).toBe(false);
  });
});
