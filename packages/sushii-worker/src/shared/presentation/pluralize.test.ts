import { describe, expect, it } from "bun:test";

import { countWithNoun, pluralizeNoun } from "./pluralize";

describe("pluralizeNoun", () => {
  it("returns the noun unchanged for a count of 1", () => {
    expect(pluralizeNoun("case", 1)).toBe("case");
  });

  it("appends 's' for any other count", () => {
    expect(pluralizeNoun("case", 0)).toBe("cases");
    expect(pluralizeNoun("case", 2)).toBe("cases");
  });

  it("swaps a consonant 'y' ending for 'ies'", () => {
    expect(pluralizeNoun("identity", 1)).toBe("identity");
    expect(pluralizeNoun("identity", 2)).toBe("identities");
  });

  it("does not treat a vowel 'y' ending as an irregular", () => {
    expect(pluralizeNoun("day", 2)).toBe("days");
  });
});

describe("countWithNoun", () => {
  it("agrees with a count of 1", () => {
    expect(countWithNoun(1, "account")).toBe("1 account");
  });

  it("agrees with any other count", () => {
    expect(countWithNoun(0, "account")).toBe("0 accounts");
    expect(countWithNoun(5, "account")).toBe("5 accounts");
  });
});
