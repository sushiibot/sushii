import { describe, expect, test } from "bun:test";

import { fingerprintSuggestions } from "./fingerprint";

describe("fingerprintSuggestions", () => {
  const a = { kind: "deleted" as const, messageIds: ["10", "11", "12"] };
  const b = { kind: "automod" as const, messageIds: ["20"] };

  test("is 8 hex chars", () => {
    expect(fingerprintSuggestions([a, b])).toMatch(/^[0-9a-f]{8}$/);
  });

  test("is stable when suggestions or ids are reordered", () => {
    const shuffled = {
      kind: "deleted" as const,
      messageIds: ["12", "10", "11"],
    };
    expect(fingerprintSuggestions([b, shuffled])).toBe(
      fingerprintSuggestions([a, b]),
    );
  });

  test("changes when a message is added or removed", () => {
    const base = fingerprintSuggestions([a, b]);
    expect(
      fingerprintSuggestions([{ ...a, messageIds: ["10", "11"] }, b]),
    ).not.toBe(base);
    expect(
      fingerprintSuggestions([
        { ...a, messageIds: [...a.messageIds, "13"] },
        b,
      ]),
    ).not.toBe(base);
  });

  test("changes when a suggestion's kind changes", () => {
    expect(fingerprintSuggestions([{ ...a, kind: "recent" }, b])).not.toBe(
      fingerprintSuggestions([a, b]),
    );
  });

  test("changes when a suggestion is dropped", () => {
    expect(fingerprintSuggestions([a])).not.toBe(
      fingerprintSuggestions([a, b]),
    );
  });
});
