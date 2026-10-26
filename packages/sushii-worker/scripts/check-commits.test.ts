import { describe, expect, it } from "bun:test";

import { checkCommits, checkSubject, subjectFromMessage } from "./check-commits";

describe("checkSubject", () => {
  it.each([
    "feat: add fishy seasons",
    "fix(social): count each UTC day once",
    "chore(db): drop legacy table",
    "refactor(guild-settings)!: split screening settings",
    "build(deps): bump drizzle-orm",
    "fix(automod, schedule): share the cooldown",
  ])("accepts %s", (subject) => {
    expect(checkSubject(subject)).toBeNull();
  });

  it.each([
    "Merge fishy and rep active days bonus",
    "Replace fishy and rep streaks",
    "feat:missing space",
    "feat(Social): uppercase scope",
    "wip: something",
    "feat: ",
    "",
  ])("rejects %s", (subject) => {
    expect(checkSubject(subject)).not.toBeNull();
  });

  it("allows autosquash markers only when asked", () => {
    expect(checkSubject("fixup! feat: add seasons")).not.toBeNull();
    expect(
      checkSubject("fixup! feat: add seasons", { allowAutosquash: true }),
    ).toBeNull();
  });
});

describe("checkCommits", () => {
  it("rejects merge commits even with a valid subject", () => {
    const errors = checkCommits([
      { sha: "a".repeat(40), subject: "feat: ok", parentCount: 1 },
      { sha: "b".repeat(40), subject: "chore: merge main", parentCount: 2 },
    ]);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("bbbbbbbb");
    expect(errors[0]).toContain("merge commit");
  });

  it("rejects autosquash commits being pushed", () => {
    expect(
      checkCommits([
        { sha: "c".repeat(40), subject: "fixup! feat: ok", parentCount: 1 },
      ]),
    ).toHaveLength(1);
  });
});

describe("subjectFromMessage", () => {
  it("skips leading blank and comment lines", () => {
    expect(
      subjectFromMessage("\n# Please enter a message\nfeat: add x\n\nbody\n"),
    ).toBe("feat: add x");
  });
});
