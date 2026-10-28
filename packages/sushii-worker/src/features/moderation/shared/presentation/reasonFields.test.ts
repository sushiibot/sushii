import { describe, expect, mock, test } from "bun:test";
import type { LabelModalData, ModalData } from "discord.js";
import { ComponentType, ModalSubmitFields } from "discord.js";

import type { ReasonFormData } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import { expandReason } from "@/features/moderation/reason-templates/domain/ReasonExpander";
import type { ReasonTemplate } from "@/features/moderation/reason-templates/domain/ReasonTemplate";

import { REASON_MAX_LENGTH } from "../domain/value-objects/Reason";
import type { ReasonFieldEmojis } from "./reasonFields";
import {
  REASON_FIELD_IDS,
  buildCurrentReasonDisplay,
  buildEditOptions,
  buildReasonTextInput,
  buildSaveTemplateCheckbox,
  buildTemplateSelect,
  formatRelativeTime,
  parseReasonFields,
} from "./reasonFields";

const GUILD_ID = "111111111111111111";
const emojis: ReasonFieldEmojis = { history: "<:history:123456789012345678>" };

function makeTemplate(overrides: Partial<ReasonTemplate> = {}): ReasonTemplate {
  return {
    id: "1",
    guildId: GUILD_ID,
    shortcut: "spam",
    content: "Spamming in chat.",
    contentKey: "spamming in chat.",
    createdBy: "222222222222222222",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: null,
    useCount: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

const spam = makeTemplate();
const noShortcut = makeTemplate({
  id: "2",
  shortcut: null,
  content: "Breaking rule 4",
});

const lastReason = {
  reason: "Last reason used",
  executorId: "333333333333333333",
  actionTime: new Date("2026-02-01T00:00:00Z"),
};

const formData: ReasonFormData = {
  last: lastReason,
  templates: [spam, noShortcut],
};

const NOW = new Date("2026-02-01T00:02:00Z");

function selectJson(
  data: ReasonFormData,
  executorName: string | null = "sana",
) {
  const label = buildTemplateSelect(data, emojis, executorName, NOW);
  if (!label) {
    throw new Error("expected a template select");
  }

  return label.toJSON();
}

interface ModalInput {
  template?: string[];
  text?: string;
  save?: boolean;
  options?: string[];
}

// Same shape discord.js builds from the API payload before wrapping it.
function makeFields(input: ModalInput): ModalSubmitFields {
  const labels: LabelModalData[] = [];
  let id = 1;
  const label = (component: ModalData): void => {
    labels.push({ type: ComponentType.Label, id: id++, component });
  };

  if (input.template) {
    label({
      type: ComponentType.StringSelect,
      id: id++,
      customId: REASON_FIELD_IDS.template,
      values: input.template,
    });
  }
  if (input.text !== undefined) {
    label({
      type: ComponentType.TextInput,
      id: id++,
      customId: REASON_FIELD_IDS.text,
      value: input.text,
    });
  }
  if (input.save !== undefined) {
    label({
      type: ComponentType.Checkbox,
      id: id++,
      customId: REASON_FIELD_IDS.save,
      value: input.save,
    });
  }
  if (input.options) {
    label({
      type: ComponentType.CheckboxGroup,
      id: id++,
      customId: REASON_FIELD_IDS.options,
      values: input.options,
    });
  }

  const Fields = ModalSubmitFields as unknown as new (
    components: LabelModalData[],
  ) => ModalSubmitFields;

  return new Fields(labels);
}

const service = {
  resolve: mock((_guildId: string, input: string | null) =>
    Promise.resolve(
      input ? expandReason(input, { templates: [spam], recents: [] }) : null,
    ),
  ),
};

describe("buildTemplateSelect", () => {
  test("returns null without options", () => {
    expect(
      buildTemplateSelect({ last: null, templates: [] }, emojis),
    ).toBeNull();
  });

  test("first option is Same as last reason with the history emoji", () => {
    const json = selectJson(formData);
    const select = json.component as {
      custom_id: string;
      options: {
        label: string;
        value: string;
        description?: string;
        emoji?: { id?: string; name?: string };
      }[];
    };

    expect(select.custom_id).toBe(REASON_FIELD_IDS.template);
    expect(select.options[0]).toMatchObject({
      label: "Same as last reason",
      value: "last",
      description: "sana · 2 min ago · Last reason used",
      emoji: { id: "123456789012345678", name: "history" },
    });
    expect(select.options[1]).toMatchObject({
      label: "!spam",
      value: "template:1",
      description: "Spamming in chat.",
    });
    expect(select.options[2]).toMatchObject({
      label: "Breaking rule 4",
      value: "template:2",
    });
  });

  test("a missing history emoji leaves the option without one", () => {
    const label = buildTemplateSelect(formData, { history: "" }, "sana", NOW);
    const select = label?.toJSON().component as {
      options: { label: string; emoji?: unknown }[];
    };

    expect(select.options[0]?.label).toBe("Same as last reason");
    expect(select.options[0]?.emoji).toBeUndefined();
  });

  test("keeps labels and descriptions within 100 chars and caps at 25 options", () => {
    const templates = Array.from({ length: 30 }, (_, i) =>
      makeTemplate({
        id: String(i + 1),
        shortcut: i % 2 === 0 ? null : "a".repeat(32),
        content: "x".repeat(3000),
      }),
    );

    const json = selectJson({
      last: { ...lastReason, reason: "y".repeat(3000) },
      templates,
    });
    const options = (
      json.component as { options: { label: string; description: string }[] }
    ).options;

    expect(options).toHaveLength(25);
    for (const option of options) {
      expect(option.label.length).toBeLessThanOrEqual(100);
      expect(option.description.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("last reason description", () => {
  interface Option {
    value: string;
    label: string;
    description?: string;
  }
  const optionsOf = (data: ReasonFormData, name: string | null = "sana") =>
    (selectJson(data, name).component as { options: Option[] }).options;

  test("falls back to time and preview without a name", () => {
    expect(optionsOf(formData, null)[0]?.description).toBe(
      "2 min ago · Last reason used",
    );
  });

  test("formats relative times as plain text", () => {
    expect(formatRelativeTime(new Date("2026-02-01T00:01:30Z"), NOW)).toBe(
      "just now",
    );
    expect(formatRelativeTime(new Date("2026-01-31T21:00:00Z"), NOW)).toBe(
      "3 hr ago",
    );
    expect(formatRelativeTime(new Date("2026-01-31T00:00:00Z"), NOW)).toBe(
      "1 day ago",
    );
    expect(formatRelativeTime(new Date("2026-01-29T00:00:00Z"), NOW)).toBe(
      "3 days ago",
    );
  });

  test("whitespace-only reasons leave out the preview", () => {
    for (const reason of ["\n", "\t "]) {
      const options = optionsOf({
        last: { ...lastReason, reason },
        templates: [makeTemplate({ id: "5", shortcut: null, content: reason })],
      });

      expect(options[0]?.description).toBe("sana · 2 min ago");
      expect(options[1]?.description).toBeUndefined();
      expect(options[1]?.label).toBe("Template");
    }
  });

  test("long names and reasons stay within 100 chars", () => {
    const [option] = optionsOf(
      { last: { ...lastReason, reason: "y".repeat(3000) }, templates: [] },
      "n".repeat(80),
    );

    expect(option?.description?.length).toBeLessThanOrEqual(100);
  });
});

describe("other builders", () => {
  test("reason text input", () => {
    const json = buildReasonTextInput({ description: "Optional" }).toJSON();

    expect(json.label).toBe("Reason or extra details");
    expect(json.description).toBe("Optional");
    expect(json.component).toMatchObject({
      custom_id: REASON_FIELD_IDS.text,
      required: false,
      max_length: REASON_MAX_LENGTH,
    });
  });

  test("save checkbox", () => {
    const json = buildSaveTemplateCheckbox().toJSON();

    expect(json.label).toBe("Save as template");
    expect(json.component).toMatchObject({
      type: ComponentType.Checkbox,
      custom_id: REASON_FIELD_IDS.save,
    });
  });

  test("edit options include update_dm only with a DM target", () => {
    const withDm = buildEditOptions({ dmTo: "spambot" }).toJSON().component as {
      options: { value: string; label: string }[];
    };
    const withoutDm = buildEditOptions({ dmTo: null }).toJSON().component as {
      options: { value: string }[];
    };

    expect(withDm.options.map((o) => o.value)).toEqual(["save", "update_dm"]);
    expect(withDm.options[1]?.label).toBe("Also update the DM sent to spambot");
    expect(withoutDm.options.map((o) => o.value)).toEqual(["save"]);
  });

  test("current reason display quotes every line", () => {
    expect(buildCurrentReasonDisplay("one\ntwo").toJSON().content).toBe(
      "**Current reason**\n> one\n> two",
    );
    expect(buildCurrentReasonDisplay(null).toJSON().content).toContain(
      "No reason set",
    );
  });

  test("current reason display stays within 4000 chars", () => {
    const content =
      buildCurrentReasonDisplay("a\n".repeat(1500)).toJSON().content ?? "";

    expect(content.length).toBeLessThanOrEqual(4000);
    expect(content.endsWith("…")).toBe(true);
  });
});

describe("parseReasonFields", () => {
  test("empty dropdown and empty text give null text", async () => {
    const result = await parseReasonFields(
      makeFields({ template: [], text: "  ", save: false }),
      formData,
      service,
      GUILD_ID,
    );

    expect(result.unwrap()).toEqual({
      text: null,
      template: null,
      unknownShortcut: null,
      unresolved: null,
      saveAsTemplate: false,
      updateDm: false,
    });
  });

  test("works when optional fields are absent", async () => {
    const result = await parseReasonFields(
      makeFields({ text: "plain" }),
      formData,
      service,
      GUILD_ID,
    );

    expect(result.unwrap()).toMatchObject({
      text: "plain",
      saveAsTemplate: false,
    });
  });

  test("dropdown template joined with typed text", async () => {
    const result = await parseReasonFields(
      makeFields({ template: ["template:1"], text: "also in #general" }),
      formData,
      service,
      GUILD_ID,
    );

    expect(result.unwrap()).toMatchObject({
      text: "Spamming in chat. Also in #general",
      template: { id: "1", shortcut: "spam" },
    });
  });

  test("same as last reason", async () => {
    const result = await parseReasonFields(
      makeFields({ template: ["last"], text: "" }),
      formData,
      service,
      GUILD_ID,
    );

    expect(result.unwrap()).toMatchObject({
      text: "Last reason used",
      template: null,
    });
  });

  test("typed shortcut expands and reports its template", async () => {
    const result = await parseReasonFields(
      makeFields({ template: [], text: "!spam again" }),
      formData,
      service,
      GUILD_ID,
    );

    expect(result.unwrap()).toMatchObject({
      text: "Spamming in chat. Again",
      template: { id: "1", shortcut: "spam" },
    });
  });

  test("unknown shortcut is reported", async () => {
    const result = await parseReasonFields(
      makeFields({ text: "!nope" }),
      formData,
      service,
      GUILD_ID,
    );

    expect(result.unwrap()).toMatchObject({
      text: "!nope",
      unknownShortcut: "nope",
    });
  });

  test("unresolved typed input is reported", async () => {
    const result = await parseReasonFields(
      makeFields({ text: "template:404" }),
      formData,
      service,
      GUILD_ID,
    );

    expect(result.unwrap()).toMatchObject({
      text: "template:404",
      unresolved: { kind: "token", input: "template:404" },
    });
  });

  test("reading a field the form doesn't have throws in discord.js", () => {
    expect(() =>
      makeFields({ text: "x" }).getCheckbox(REASON_FIELD_IDS.save),
    ).toThrow();
  });

  test("save checkbox and options group", async () => {
    const fromCheckbox = await parseReasonFields(
      makeFields({ text: "x", save: true }),
      formData,
      service,
      GUILD_ID,
    );
    const fromOptions = await parseReasonFields(
      makeFields({ text: "x", options: ["save", "update_dm"] }),
      formData,
      service,
      GUILD_ID,
    );

    expect(fromCheckbox.unwrap()).toMatchObject({
      saveAsTemplate: true,
      updateDm: false,
    });
    expect(fromOptions.unwrap()).toMatchObject({
      saveAsTemplate: true,
      updateDm: true,
    });
  });

  test("too long after combining", async () => {
    const result = await parseReasonFields(
      makeFields({
        template: ["template:1"],
        text: "x".repeat(REASON_MAX_LENGTH),
      }),
      formData,
      service,
      GUILD_ID,
    );

    expect(result.err).toBe(true);
    expect(result.val).toEqual({
      code: "too_long",
      length: "Spamming in chat. X".length + REASON_MAX_LENGTH - 1,
      max: REASON_MAX_LENGTH,
    });
  });

  test("records the source with the surface when tracked", async () => {
    const recordReasonResolved = mock();
    const tracking = {
      metrics: { recordReasonResolved },
      surface: "edit" as const,
    };

    await parseReasonFields(
      makeFields({ template: ["last"], text: "" }),
      formData,
      service,
      GUILD_ID,
      tracking,
    );
    await parseReasonFields(
      makeFields({ template: ["template:1"], text: "also" }),
      formData,
      service,
      GUILD_ID,
      tracking,
    );
    await parseReasonFields(
      makeFields({
        template: ["template:1"],
        text: "x".repeat(REASON_MAX_LENGTH),
      }),
      formData,
      service,
      GUILD_ID,
      tracking,
    );
    await parseReasonFields(
      makeFields({ template: [], text: "  " }),
      formData,
      service,
      GUILD_ID,
      tracking,
    );

    expect(recordReasonResolved.mock.calls).toEqual([
      ["edit", "recent"],
      ["edit", "template"],
      ["edit", "too_long"],
    ]);
  });
});
