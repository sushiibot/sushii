import { describe, expect, test } from "bun:test";
import { DiscordjsErrorCodes, DiscordjsTypeError } from "discord.js";

import {
  type ModerationModalFields,
  buildModerationActionModal,
  parseModalDeleteSeconds,
  parseModalDuration,
  parseModalReason,
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

describe("buildModerationActionModal", () => {
  test("timeout has a required duration select before the reason", () => {
    const modal = buildModerationActionModal("timeout", "cid").toJSON();

    expect(modal.title).toBe("Timeout User");
    expect(modal.custom_id).toBe("cid");
    expect(modal.components).toHaveLength(2);
    expect(modal.components[0]).toMatchObject({
      type: 18,
      label: "Duration",
      component: { type: 3, custom_id: "duration", required: true },
    });

    const select = modal.components[0] as {
      component: { options: { value: string; default?: boolean }[] };
    };
    expect(select.component.options.map((o) => o.value)).toEqual([
      "10m",
      "1h",
      "1d",
      "7d",
    ]);
    expect(
      select.component.options.filter((o) => o.default).map((o) => o.value),
    ).toEqual(["1h"]);

    expect(modal.components[1]).toMatchObject({
      type: 1,
      components: [{ type: 4, custom_id: "reason", required: false }],
    });
  });

  test("untimeout has only the reason", () => {
    const modal = buildModerationActionModal("untimeout", "cid").toJSON();

    expect(modal.title).toBe("Remove Timeout");
    expect(modal.components).toHaveLength(1);
    expect(modal.components[0]).toMatchObject({
      type: 1,
      components: [{ type: 4, custom_id: "reason" }],
    });
  });

  test("ban keeps the reason row then the delete history select", () => {
    const modal = buildModerationActionModal("ban", "cid").toJSON();

    expect(modal.title).toBe("Ban User");
    expect(modal.components).toHaveLength(2);
    expect(modal.components[0]).toMatchObject({
      type: 1,
      components: [{ type: 4, custom_id: "reason" }],
    });
    expect(modal.components[1]).toMatchObject({
      type: 18,
      label: "Delete message history",
      component: { type: 3, custom_id: "delete_seconds" },
    });

    const select = modal.components[1] as {
      component: { options: { value: string }[] };
    };
    expect(select.component.options.map((o) => o.value)).toEqual([
      "3600",
      "0",
      "43200",
      "86400",
      "259200",
      "604800",
    ]);
  });

  test("softban omits the don't-delete option", () => {
    const modal = buildModerationActionModal("softban", "cid").toJSON();
    const select = modal.components[1] as {
      component: { options: { value: string }[] };
    };

    expect(select.component.options.map((o) => o.value)).not.toContain("0");
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

describe("parseModalReason", () => {
  test("blank is null", () => {
    expect(parseModalReason(fields({ reason: "  " }, {})).unwrap()).toBeNull();
  });

  test("trims the reason", () => {
    expect(
      parseModalReason(fields({ reason: " spam " }, {})).unwrap()?.value,
    ).toBe("spam");
  });

  test("rejects an overlong reason", () => {
    const result = parseModalReason(fields({ reason: "x".repeat(3001) }, {}));

    expect(result.err).toBe(true);
    expect(result.val).toStartWith("Invalid reason:");
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
