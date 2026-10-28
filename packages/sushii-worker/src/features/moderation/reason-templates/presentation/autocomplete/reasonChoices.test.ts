import { describe, expect, test } from "bun:test";

import type {
  RecentReasonEntry,
  TemplateLike,
} from "../../domain/ReasonExpander";
import { expandReason, joinReason } from "../../domain/ReasonExpander";
import type { ReasonChoice } from "./reasonChoices";
import {
  MAX_CHOICES,
  SHOWN_RECENT_LIMIT,
  buildReasonChoices,
} from "./reasonChoices";

const SPAM: TemplateLike = {
  id: "11",
  shortcut: "spam",
  content:
    "Spamming in channels (rule 3). Repeated messages, mass mentions or unrelated links. Please keep conversations readable for everyone.",
};
const NSFW: TemplateLike = {
  id: "12",
  shortcut: "nsfw",
  content: "Posting NSFW content outside age-restricted channels (rule 5).",
};
const SCAM: TemplateLike = {
  id: "13",
  shortcut: "scam",
  content:
    "Compromised account posting scam links (free Nitro / crypto). You can be unbanned once the account is secured, DM a mod.",
};
const RAID: TemplateLike = {
  id: "14",
  shortcut: null,
  content:
    "Raid participant: joined during the Oct 26 raid and posted copy-paste spam in #general.",
};
const HARASSMENT: TemplateLike = {
  id: "15",
  shortcut: "harassment",
  content: "Continued harassing other members after a warning (rule 1).",
};
const TEMPLATES = [SPAM, NSFW, SCAM, RAID, HARASSMENT];

const RECENTS: RecentReasonEntry[] = [
  {
    caseId: "4821",
    reason: "Alt account of a banned user (matched by mod view alts).",
  },
  { caseId: "4817", reason: "Advertising another server in DMs to members." },
];

const sources = { templates: TEMPLATES, recents: RECENTS };
const empty = { templates: [], recents: [] };

function expectValid(choices: ReasonChoice[]) {
  expect(choices.length).toBeLessThanOrEqual(MAX_CHOICES);
  for (const choice of choices) {
    expect(choice.name.trim().length).toBeGreaterThan(0);
    expect(choice.value.trim().length).toBeGreaterThan(0);
    expect(choice.name.length).toBeLessThanOrEqual(100);
    expect(choice.value.length).toBeLessThanOrEqual(100);
  }
}

function manyTemplates(n: number): TemplateLike[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(100 + i),
    shortcut: `t${i}`,
    content: `Template number ${i} ${"x".repeat(150)}`,
  }));
}

describe("buildReasonChoices", () => {
  test("offers only the newest few recent reasons", () => {
    const manyRecents = Array.from({ length: 8 }, (_, i) => ({
      caseId: String(5000 - i),
      reason: `Raid account number ${i}`,
    }));
    const recentNames = (typed: string) =>
      buildReasonChoices(typed, { templates: TEMPLATES, recents: manyRecents })
        .map((c) => c.name)
        .filter((n) => n.startsWith("Recent · "));

    expect(recentNames("")).toEqual([
      "Recent · Raid account number 0",
      "Recent · Raid account number 1",
      "Recent · Raid account number 2",
    ]);
    expect(recentNames("")).toHaveLength(SHOWN_RECENT_LIMIT);
  });

  test("typing never offers recent reasons", () => {
    const choices = buildReasonChoices("alt account", sources);

    expect(choices.some((c) => c.name.startsWith("Recent · "))).toBe(false);
  });

  test("empty field lists templates then recents, with no tip", () => {
    const choices = buildReasonChoices("", sources);

    expect(choices.map((c) => c.value)).toEqual([
      "!spam",
      "!nsfw",
      "!scam",
      "template:14",
      "!harassment",
      "recent:4821",
      "recent:4817",
    ]);
    expect(choices[0].name.startsWith("!spam · Spamming in channels")).toBe(
      true,
    );
    expect(choices[3].name.startsWith("Template · Raid participant")).toBe(
      true,
    );
    expect(choices[5].name.startsWith("Recent · Alt account")).toBe(true);
    expect(choices.some((c) => c.name.startsWith("Tip:"))).toBe(false);
    expectValid(choices);
  });

  test("whitespace-only input counts as empty", () => {
    expect(buildReasonChoices("   ", sources)).toEqual(
      buildReasonChoices("", sources),
    );
  });

  test("empty field keeps slots for recents when templates fill the list", () => {
    const choices = buildReasonChoices("", {
      templates: manyTemplates(60),
      recents: RECENTS,
    });

    expect(choices).toHaveLength(MAX_CHOICES);
    expect(choices.slice(-2).map((c) => c.value)).toEqual([
      "recent:4821",
      "recent:4817",
    ]);
    expectValid(choices);
  });

  test("recents that repeat a template or are blank are dropped", () => {
    const choices = buildReasonChoices("", {
      templates: [NSFW],
      recents: [
        { caseId: "1", reason: `  ${NSFW.content.toUpperCase()} ` },
        { caseId: "2", reason: "   " },
        { caseId: "3", reason: "Other reason" },
      ],
    });

    expect(choices.map((c) => c.value)).toEqual(["!nsfw", "recent:3"]);
  });

  test("typing only searches templates", () => {
    const choices = buildReasonChoices("raid", {
      templates: TEMPLATES,
      recents: [
        { caseId: "4790", reason: "Raid bot, joined in the Oct 26 wave." },
      ],
    });

    expect(choices).toEqual([
      expect.objectContaining({ value: "template:14" }),
    ]);
    expectValid(choices);
  });

  test("typing that matches no template returns no choices", () => {
    expect(buildReasonChoices("softban test", sources)).toEqual([]);
  });

  test("typing matches shortcuts case-insensitively", () => {
    const values = buildReasonChoices("HARASS", sources).map((c) => c.value);

    expect(values).toEqual(["!harassment"]);
  });

  test("known shortcut with extra text previews the expansion, valued as typed", () => {
    const typed = "!spam also in #general";
    const choices = buildReasonChoices(typed, sources);

    expect(choices).toHaveLength(1);
    expect(choices[0].value).toBe(typed);
    expect(choices[0].name.startsWith("!spam → Spamming")).toBe(true);
    expect(choices[0].name.endsWith(" + also in #general")).toBe(true);
    expectValid(choices);
  });

  test("known shortcut over 100 characters gets no choice", () => {
    expect(buildReasonChoices(`!spam ${"a".repeat(120)}`, sources)).toEqual([]);
  });

  test("exact shortcut lists that template first", () => {
    const choices = buildReasonChoices("!spam", sources);

    expect(choices.map((c) => c.value)).toEqual(["!spam"]);
  });

  test("unknown shortcut only suggests the closest one", () => {
    const choices = buildReasonChoices("!spma", sources);

    expect(choices).toHaveLength(1);
    expect(choices[0].name.startsWith("Did you mean !spam · Spamming")).toBe(
      true,
    );
    expect(choices[0].value).toBe("!spam");
    expectValid(choices);
  });

  test("unknown shortcut with extra text keeps the extra in the suggestion", () => {
    const choices = buildReasonChoices("!spma in #general", sources);

    expect(choices.map((c) => c.value)).toEqual(["!spam in #general"]);
  });

  test("partial shortcut lists the shortcuts it could become", () => {
    const choices = buildReasonChoices("!s", sources);

    expect(choices.map((c) => c.value)).toEqual(["!spam", "!scam"]);
  });

  test("nothing saved and empty field lists recents only", () => {
    const choices = buildReasonChoices("", { templates: [], recents: RECENTS });

    expect(choices.map((c) => c.value)).toEqual(["recent:4821", "recent:4817"]);
  });

  test("nothing saved and nothing recent returns no choices", () => {
    expect(buildReasonChoices("", empty)).toEqual([]);
  });

  test("nothing saved and typing returns no choices", () => {
    expect(buildReasonChoices("spam bot", empty)).toEqual([]);
    expect(buildReasonChoices("!spam", empty)).toEqual([]);
  });

  test("never more than 25 choices while typing", () => {
    const choices = buildReasonChoices("template", {
      templates: manyTemplates(60),
      recents: RECENTS,
    });

    expect(choices).toHaveLength(MAX_CHOICES);
    expectValid(choices);
  });

  test("a picked label with more text typed after it gets no choices", () => {
    const label = buildReasonChoices("", sources)[0].name;

    expect(buildReasonChoices(`${label} also spam`, sources)).toEqual([]);
  });

  test("an edited choice name gets no choices", () => {
    expect(buildReasonChoices("Recent · something else", sources)).toEqual([]);
  });

  test("every choice resolves to its intended text through expandReason", () => {
    for (const choice of buildReasonChoices("", sources)) {
      const result = expandReason(choice.value, sources);

      expect(result.unresolved).toBeNull();
      expect(result.source).toBe("token");
    }

    for (const typed of ["!spma", "raid", "!spam also in #general"]) {
      for (const choice of buildReasonChoices(typed, sources)) {
        expect(expandReason(choice.value, sources).unresolved).toBeNull();
      }
    }
  });

  describe("picked values expand to what the mod typed", () => {
    const textOf = (value: string) => expandReason(value, sources).text;
    const choiceNamed = (typed: string, prefix: string) => {
      const choice = buildReasonChoices(typed, sources).find((c) =>
        c.name.startsWith(prefix),
      );
      if (!choice) {
        throw new Error(`no "${prefix}" choice for ${typed}`);
      }
      return choice;
    };

    test("known shortcut with extra text", () => {
      const typed = "!spam also in #general";
      const choice = choiceNamed(typed, "!spam → ");

      expect(textOf(choice.value)).toBe(textOf(typed));
      expect(textOf(choice.value)).toBe(
        joinReason(SPAM.content, "also in #general"),
      );
    });

    test("did you mean keeps the extra text, swapping only the shortcut", () => {
      const choice = choiceNamed("!spma in #general", "Did you mean ");

      expect(textOf(choice.value)).toBe(
        joinReason(SPAM.content, "in #general"),
      );
    });

    test("did you mean with a long extra keeps all of it", () => {
      const extra = "e".repeat(93);
      const choice = choiceNamed(`!spma ${extra}`, "Did you mean ");

      expect(choice.value).toBe(`!spam ${extra}`);
      expect(textOf(choice.value)).toBe(joinReason(SPAM.content, extra));
    });

    test("no did you mean when no shortcut is close", () => {
      for (const typed of ["!zzzz posted links", "!q"]) {
        const names = buildReasonChoices(typed, sources).map((c) => c.name);

        expect(names.some((n) => n.startsWith("Did you mean"))).toBe(false);
      }
    });

    test("every value is the typed text or resolves to a template", () => {
      const inputs = [
        "",
        "raid",
        "!spam also",
        "!spma in #general",
        "!zzzz posted links",
        "!q",
        "!sp",
        "template:14",
        "recent:4821",
        "spam bot",
      ];

      for (const typed of inputs) {
        for (const choice of buildReasonChoices(typed, sources)) {
          const result = expandReason(choice.value, sources);
          const resolved =
            result.source === "token" || result.source === "shortcut";

          expect(choice.value === typed || resolved).toBe(true);
          expect(result.unresolved).toBeNull();
        }
      }
    });

    test("did you mean is omitted when the extra text wouldn't fit", () => {
      const typed = `!harasment ${"e".repeat(89)}`;

      expect(typed.length).toBe(100);
      expect(buildReasonChoices(typed, sources)).toEqual([]);
    });

    test("a 95 character extra gets no choice that would cut it", () => {
      const typed = `!spam ${"e".repeat(95)}`;

      expect(buildReasonChoices(typed, sources)).toEqual([]);
      expect(buildReasonChoices(`!spma ${"e".repeat(95)}`, sources)).toEqual(
        [],
      );
    });
  });

  test("a typed token for a template without a shortcut lists only it", () => {
    expect(
      buildReasonChoices("template:14", sources).map((c) => c.value),
    ).toEqual(["template:14"]);
  });

  test("every choice name is still recognized after it's edited", () => {
    const names = [
      ...["", "raid", "!spma", "!s", "!spam also in #general"].flatMap(
        (typed) => buildReasonChoices(typed, sources).map((c) => c.name),
      ),
    ];

    for (const name of names) {
      const result = expandReason(`${name} more`, sources);

      expect(result.unresolved !== null || result.source === "label").toBe(
        true,
      );
    }
  });
});
