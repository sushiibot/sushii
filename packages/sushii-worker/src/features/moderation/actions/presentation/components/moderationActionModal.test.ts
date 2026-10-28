import { describe, expect, test } from "bun:test";
import { DiscordjsErrorCodes, DiscordjsTypeError } from "discord.js";

import type { ReasonFormData } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import type { ReasonTemplate } from "@/features/moderation/reason-templates/domain/ReasonTemplate";

import {
  type ModerationModalAction,
  type ModerationModalFields,
  buildModerationActionModal,
  buildModerationActionTitle,
  parseModalDeleteSeconds,
  parseModalDuration,
} from "./moderationActionModal";

function fields(
  text: Record<string, string>,
  selects: Record<string, string[]>,
): ModerationModalFields {
  return {
    getTextInputValue: (id: string) => {
      const value = text[id];
      if (value === undefined) {
        throw new Error(`missing ${id}`);
      }
      return value;
    },
    getStringSelectValues: (id: string) => {
      const value = selects[id];
      if (value === undefined) {
        throw new Error(`missing ${id}`);
      }
      return value;
    },
  } as ModerationModalFields;
}

const EMOJIS = { history: "<:history:1400000000000000200>" };

const TEMPLATE: ReasonTemplate = {
  id: "11",
  guildId: "187450744427773963",
  shortcut: "spam",
  content: "Spamming in channels (rule 3).",
  contentKey: "k",
  createdBy: "150443906511667200",
  createdAt: new Date("2026-10-01T00:00:00.000Z"),
  updatedAt: null,
  useCount: 14,
  lastUsedAt: null,
};

const WITH_TEMPLATES: ReasonFormData = {
  last: {
    reason: "Raid participant.",
    executorId: "238381427315195904",
    actionTime: new Date(),
  },
  templates: [TEMPLATE],
};

const EMPTY: ReasonFormData = { last: null, templates: [] };

function build(
  actionType: ModerationModalAction,
  formData: ReasonFormData = WITH_TEMPLATES,
  targetName = "spambot",
) {
  return buildModerationActionModal({
    actionType,
    customId: "cid",
    targetName,
    formData,
    emojis: EMOJIS,
  }).toJSON();
}

interface LabelJSON {
  type: number;
  label: string;
  component: {
    type: number;
    custom_id: string;
    required?: boolean;
    options?: { value: string; default?: boolean }[];
  };
}

function labels(modal: ReturnType<typeof build>): LabelJSON[] {
  return modal.components as unknown as LabelJSON[];
}

describe("buildModerationActionModal", () => {
  test("ban: delete history, then Template, Reason and Save as template", () => {
    const modal = build("ban");

    expect(modal.title).toBe("Ban spambot");
    expect(modal.custom_id).toBe("cid");
    expect(labels(modal).map((l) => l.component.custom_id)).toEqual([
      "delete_seconds",
      "reason_template",
      "reason",
      "save_as_template",
    ]);
    expect(labels(modal).map((l) => l.label)).toEqual([
      "Delete message history",
      "Template",
      "Reason or extra details",
      "Save as template",
    ]);
    expect(labels(modal)[0]?.component.options?.map((o) => o.value)).toEqual([
      "3600",
      "0",
      "43200",
      "86400",
      "259200",
      "604800",
    ]);
  });

  test("timeout: required duration first, defaulting to 1h", () => {
    const modal = build("timeout");

    expect(modal.title).toBe("Timeout spambot");
    const [duration] = labels(modal);
    expect(duration).toMatchObject({
      type: 18,
      label: "Duration",
      component: { type: 3, custom_id: "duration", required: true },
    });
    expect(duration?.component.options?.map((o) => o.value)).toEqual([
      "10m",
      "1h",
      "1d",
      "7d",
    ]);
    expect(
      duration?.component.options?.filter((o) => o.default).map((o) => o.value),
    ).toEqual(["1h"]);
    expect(labels(modal).map((l) => l.component.custom_id)).toEqual([
      "duration",
      "reason_template",
      "reason",
      "save_as_template",
    ]);
  });

  test("untimeout has only the reason fields", () => {
    const modal = build("untimeout");

    expect(modal.title).toBe("Remove timeout for spambot");
    expect(labels(modal).map((l) => l.component.custom_id)).toEqual([
      "reason_template",
      "reason",
      "save_as_template",
    ]);
  });

  test("softban omits the don't-delete option", () => {
    const [history] = labels(build("softban"));

    expect(history?.component.options?.map((o) => o.value)).not.toContain("0");
  });

  test("leaves the dropdown out when there's nothing to pick", () => {
    const modal = build("warn", EMPTY);

    expect(labels(modal).map((l) => l.component.custom_id)).toEqual([
      "reason",
      "save_as_template",
    ]);
    expect(labels(modal)[0]?.label).toBe("Reason");
  });

  test("the dropdown starts with Same as last reason, then templates", () => {
    const [, select] = labels(build("ban"));

    expect(select?.component.options?.map((o) => o.value)).toEqual([
      "last",
      "template:11",
    ]);
  });

  test("cuts a long name so the title fits 45 characters", () => {
    for (const action of ["ban", "untimeout"] as const) {
      const title = build(action, EMPTY, "n".repeat(100)).title;
      expect(title.length).toBeLessThanOrEqual(45);
      expect(title).toEndWith("…");
    }
  });

  test("a blank name falls back to user", () => {
    expect(buildModerationActionTitle("kick", "  ")).toBe("Kick user");
  });
});

describe("parseModalDuration", () => {
  test.each([
    ["10m", 600],
    ["1h", 3600],
    ["1d", 86400],
    ["7d", 604800],
  ])("parses %s", (value, seconds) => {
    const result = parseModalDuration(fields({}, { duration: [value] }));

    expect(result.ok).toBe(true);
    expect(result.unwrap().asSeconds()).toBe(seconds);
  });

  test("rejects a value that isn't an option", () => {
    const result = parseModalDuration(fields({}, { duration: ["28d"] }));

    expect(result.err).toBe(true);
  });

  test("an empty selection falls back to 1h", () => {
    const result = parseModalDuration(fields({}, { duration: [] }));

    expect(result.unwrap().asSeconds()).toBe(3600);
  });

  test("a select missing from the submit falls back to 1h", () => {
    const missing = {
      getTextInputValue: () => "",
      getStringSelectValues: (id: string) => {
        // The constructor is private in the typings only.
        const FieldError = DiscordjsTypeError as unknown as new (
          code: string,
          ...args: unknown[]
        ) => Error;
        throw new FieldError(
          DiscordjsErrorCodes.ModalSubmitInteractionFieldNotFound,
          id,
        );
      },
    } as unknown as ModerationModalFields;

    expect(parseModalDuration(missing).unwrap().asSeconds()).toBe(3600);
  });

  test("a select submitted without values falls back to 1h", () => {
    const noValues = {
      getTextInputValue: () => "",
      getStringSelectValues: () => undefined,
    } as unknown as ModerationModalFields;

    expect(parseModalDuration(noValues).unwrap().asSeconds()).toBe(3600);
  });

  test("other errors are rethrown", () => {
    expect(() => parseModalDuration(fields({}, {}))).toThrow(
      "missing duration",
    );
  });
});

describe("parseModalDeleteSeconds", () => {
  test("reads the selected seconds", () => {
    expect(
      parseModalDeleteSeconds(fields({}, { delete_seconds: ["86400"] })),
    ).toBe(86400);
  });

  test("defaults to 0 when the select is missing", () => {
    expect(parseModalDeleteSeconds(fields({}, {}))).toBe(0);
  });
});
