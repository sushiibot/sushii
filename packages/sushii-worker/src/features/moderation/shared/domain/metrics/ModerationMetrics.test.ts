import { describe, expect, test } from "bun:test";

import type { ExpandedReason } from "./ModerationMetrics";
import { reasonSource, templateChangeOutcome } from "./ModerationMetrics";

const TEMPLATE = { id: "3", shortcut: "spam" };

function expanded(overrides: Partial<ExpandedReason> = {}): ExpandedReason {
  return {
    source: "none",
    template: null,
    unknownShortcut: null,
    unresolved: null,
    ...overrides,
  };
}

function source(
  input: Partial<Parameters<typeof reasonSource>[0]>,
): ReturnType<typeof reasonSource> {
  return reasonSource({
    surface: "command",
    expanded: null,
    tooLong: false,
    hasText: true,
    ...input,
  });
}

describe("reasonSource", () => {
  test("a template token or label is a template", () => {
    expect(
      source({ expanded: expanded({ source: "token", template: TEMPLATE }) }),
    ).toBe("template");
    expect(
      source({ expanded: expanded({ source: "label", template: TEMPLATE }) }),
    ).toBe("template");
  });

  test("a token or label without a template is a recent reason", () => {
    expect(source({ expanded: expanded({ source: "token" }) })).toBe("recent");
    expect(source({ expanded: expanded({ source: "label" }) })).toBe("recent");
  });

  test("an exact !shortcut is a template pick on commands, typed on forms", () => {
    const exact = expanded({ source: "token", template: TEMPLATE });

    expect(source({ surface: "command", expanded: exact })).toBe("template");
    expect(source({ surface: "reason_cmd", expanded: exact })).toBe("template");
    expect(source({ surface: "form", expanded: exact })).toBe("shortcut");
    expect(source({ surface: "edit", expanded: exact })).toBe("shortcut");
  });

  test("a template token without a shortcut stays a template on forms", () => {
    expect(
      source({
        surface: "form",
        expanded: expanded({
          source: "token",
          template: { shortcut: null },
        }),
      }),
    ).toBe("template");
  });

  test("!shortcut with extra text is a shortcut on every surface", () => {
    const withExtra = expanded({ source: "shortcut", template: TEMPLATE });

    expect(source({ surface: "command", expanded: withExtra })).toBe(
      "shortcut",
    );
    expect(source({ surface: "edit", expanded: withExtra })).toBe("shortcut");
  });

  test("an unknown shortcut", () => {
    expect(source({ expanded: expanded({ unknownShortcut: "spma" }) })).toBe(
      "unknown_shortcut",
    );
  });

  test("unresolved is refused, even when the text is also too long", () => {
    expect(
      source({
        expanded: expanded({ unresolved: { kind: "token" } }),
        tooLong: true,
      }),
    ).toBe("refused");
  });

  test("too long wins over the expansion source", () => {
    expect(
      source({
        expanded: expanded({ source: "shortcut", template: TEMPLATE }),
        tooLong: true,
      }),
    ).toBe("too_long");
  });

  test("dropdown picks map to template or recent", () => {
    expect(source({ picked: "template" })).toBe("template");
    expect(source({ picked: "recent" })).toBe("recent");
  });

  test("a typed expansion wins over the dropdown pick", () => {
    expect(
      source({
        picked: "recent",
        expanded: expanded({ source: "shortcut", template: TEMPLATE }),
      }),
    ).toBe("shortcut");
    expect(source({ picked: "template", expanded: expanded() })).toBe(
      "template",
    );
  });

  test("plain text is typed; nothing is not counted", () => {
    expect(source({ expanded: expanded() })).toBe("typed");
    expect(source({ hasText: false })).toBeNull();
  });
});

describe("templateChangeOutcome", () => {
  test("maps every error code", () => {
    expect(templateChangeOutcome("shortcut_taken")).toBe("conflict");
    expect(templateChangeOutcome("duplicate")).toBe("conflict");
    expect(templateChangeOutcome("limit_reached")).toBe("limit");
    expect(templateChangeOutcome("invalid_shortcut")).toBe("invalid");
    expect(templateChangeOutcome("empty")).toBe("invalid");
    expect(templateChangeOutcome("too_long")).toBe("invalid");
    expect(templateChangeOutcome("not_found")).toBe("not_found");
  });
});
