import { describe, expect, test } from "bun:test";

import { SCREENING_RULES, rulesFor, topRule } from "./rules";
import { SCREENING_DEFAULTS, type ScreeningGuildSettings } from "./types";

function settings(
  rules: ScreeningGuildSettings["rules"],
): ScreeningGuildSettings {
  return {
    guildId: "1",
    logChannelId: null,
    rules,
    ...SCREENING_DEFAULTS,
  };
}

describe("rulesFor", () => {
  test("null means every rule that is not opt-in", () => {
    const ids = rulesFor(settings(null)).map((r) => r.id);
    expect(ids).toEqual([
      "scam",
      "promo",
      "sexual",
      "hate",
      "harassment",
      "underage",
    ]);
  });

  test("an explicit list enables opt-in rules, in definition order", () => {
    const ids = rulesFor(settings(["sale", "scam"])).map((r) => r.id);
    expect(ids).toEqual(["scam", "sale"]);
  });

  test("every rule has examples on both sides", () => {
    for (const r of SCREENING_RULES) {
      expect(r.criteria.true.examples.length).toBeGreaterThan(0);
      expect(r.criteria.false.examples.length).toBeGreaterThan(0);
    }
  });
});

describe("topRule", () => {
  test("picks the highest score", () => {
    expect(topRule({ scam: 0.2, harassment: 0.8 })).toBe("harassment");
  });

  test("ties go to the earlier rule", () => {
    expect(topRule({ hate: 0.5, scam: 0.5 })).toBe("scam");
  });

  test("empty scores give null", () => {
    expect(topRule({})).toBeNull();
  });
});
