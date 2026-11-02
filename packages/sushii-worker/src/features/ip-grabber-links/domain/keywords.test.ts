import { describe, expect, test } from "bun:test";

import { mergeKeywords, toKeyword, toKeywords } from "./keywords";

describe("toKeyword", () => {
  test("wraps the hostname in wildcards", () => {
    expect(toKeyword("Grabify.Link")).toBe("*grabify.link*");
  });

  test("skips hostnames over Discord's 60 character keyword limit", () => {
    expect(toKeyword(`${"a".repeat(55)}.com`)).toBeNull();
    expect(toKeyword(`${"a".repeat(54)}.com`)).toBe(`*${"a".repeat(54)}.com*`);
  });

  test("toKeywords dedupes and sorts", () => {
    expect(toKeywords(["b.com", "a.com", "B.com"])).toEqual([
      "*a.com*",
      "*b.com*",
    ]);
  });
});

describe("mergeKeywords", () => {
  test("adds managed keywords next to the server's own", () => {
    const result = mergeKeywords({
      ruleKeywords: ["badword", "*spam*"],
      previouslyManaged: [],
      desired: ["*grabify.link*", "*2no.co*"],
    });

    expect(result.next).toEqual([
      "badword",
      "*spam*",
      "*grabify.link*",
      "*2no.co*",
    ]);
    expect(result.managed).toEqual(["*grabify.link*", "*2no.co*"]);
    expect(result.changed).toBe(true);
  });

  test("removes only keywords sushii added when they're no longer wanted", () => {
    const result = mergeKeywords({
      ruleKeywords: ["badword", "*grabify.link*", "*old.icu*"],
      previouslyManaged: ["*grabify.link*", "*old.icu*"],
      desired: ["*grabify.link*"],
    });

    expect(result.next).toEqual(["badword", "*grabify.link*"]);
    expect(result.managed).toEqual(["*grabify.link*"]);
  });

  test("turning off removes every managed keyword and nothing else", () => {
    const result = mergeKeywords({
      ruleKeywords: ["badword", "*grabify.link*"],
      previouslyManaged: ["*grabify.link*"],
      desired: [],
    });

    expect(result.next).toEqual(["badword"]);
    expect(result.managed).toEqual([]);
  });

  test("a keyword the server already had stays theirs", () => {
    const added = mergeKeywords({
      ruleKeywords: ["*GRABIFY.link*"],
      previouslyManaged: [],
      desired: ["*grabify.link*", "*2no.co*"],
    });
    expect(added.next).toEqual(["*GRABIFY.link*", "*2no.co*"]);
    expect(added.managed).toEqual(["*2no.co*"]);

    const off = mergeKeywords({
      ruleKeywords: added.next,
      previouslyManaged: added.managed,
      desired: [],
    });
    expect(off.next).toEqual(["*GRABIFY.link*"]);
  });

  test("re-adds a managed keyword the server deleted", () => {
    const result = mergeKeywords({
      ruleKeywords: ["badword"],
      previouslyManaged: ["*grabify.link*"],
      desired: ["*grabify.link*"],
    });

    expect(result.next).toEqual(["badword", "*grabify.link*"]);
    expect(result.changed).toBe(true);
  });

  test("unchanged when the rule already matches, in any order", () => {
    const result = mergeKeywords({
      ruleKeywords: ["*grabify.link*", "badword"],
      previouslyManaged: ["*grabify.link*"],
      desired: ["*grabify.link*"],
    });

    expect(result.changed).toBe(false);
  });

  test("a stored superset from an interrupted write still counts as sushii's", () => {
    // Written before the rule edit so a crash between the two can't strand keywords.
    const result = mergeKeywords({
      ruleKeywords: ["badword", "*a.com*", "*b.com*"],
      previouslyManaged: ["*a.com*", "*b.com*", "*c.com*"],
      desired: [],
    });

    expect(result.next).toEqual(["badword"]);
  });
});
