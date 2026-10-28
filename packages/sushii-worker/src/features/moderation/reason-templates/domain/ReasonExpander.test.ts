import { describe, expect, test } from "bun:test";

import type { RecentReasonEntry, TemplateLike } from "./ReasonExpander";
import {
  LABEL_MAX_LENGTH,
  buildExpansionLabel,
  buildRecentLabel,
  buildTemplateLabel,
  closestShortcut,
  expandReason,
  joinReason,
  normalizeReason,
  normalizeShortcut,
  previewText,
  reasonContentKey,
  recentChoiceValue,
  templateChoiceValue,
} from "./ReasonExpander";

const spam: TemplateLike = {
  id: "1",
  shortcut: "spam",
  content: "Spamming in chat.",
};
const spamLinks: TemplateLike = {
  id: "2",
  shortcut: "spamlinks",
  content: "Posting spam links",
};
const noShortcut: TemplateLike = {
  id: "3",
  shortcut: null,
  content: "Breaking rule 4",
};
const longTemplate: TemplateLike = {
  id: "4",
  shortcut: "long",
  content: "Repeated harassment of other members ".repeat(20).trim(),
};
const recent: RecentReasonEntry = { caseId: "42", reason: "Raid account" };

const sources = {
  templates: [spam, spamLinks, noShortcut, longTemplate],
  recents: [recent],
};

describe("reasonContentKey", () => {
  test("is a sha256 hex of the normalized reason", () => {
    const key = reasonContentKey("  Spam\n LINK ");

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(reasonContentKey("spam link"));
    expect(key).not.toBe(reasonContentKey("spam links"));
  });
});

describe("normalizeReason", () => {
  test("lowercases, trims and collapses whitespace", () => {
    expect(normalizeReason("  Spam\n\tLINK   here ")).toBe("spam link here");
  });
});

describe("normalizeShortcut", () => {
  test("strips one leading ! and lowercases", () => {
    expect(normalizeShortcut("!Spam").unwrap()).toBe("spam");
    expect(normalizeShortcut("spam_1-x").unwrap()).toBe("spam_1-x");
  });

  test("trims surrounding whitespace", () => {
    expect(normalizeShortcut("  !spam ").unwrap()).toBe("spam");
  });

  test("rejects a second leading !", () => {
    expect(normalizeShortcut("!!spam").err).toBe(true);
  });

  test("rejects empty, bare ! and a leading separator", () => {
    expect(normalizeShortcut("").err).toBe(true);
    expect(normalizeShortcut("!").err).toBe(true);
    expect(normalizeShortcut("-spam").err).toBe(true);
    expect(normalizeShortcut("_spam").err).toBe(true);
  });

  test("rejects spaces and other characters", () => {
    expect(normalizeShortcut("spam links").err).toBe(true);
    expect(normalizeShortcut("spam.links").err).toBe(true);
    expect(normalizeShortcut("späm").err).toBe(true);
  });

  test("allows 32 characters and rejects 33", () => {
    expect(normalizeShortcut("a".repeat(32)).ok).toBe(true);
    expect(normalizeShortcut("a".repeat(33)).err).toBe(true);
  });
});

describe("joinReason", () => {
  test("capitalizes extra after a finished sentence", () => {
    expect(joinReason("Spamming in chat.", "also in #general")).toBe(
      "Spamming in chat. Also in #general",
    );
    expect(joinReason("Stop!", "now")).toBe("Stop! Now");
    expect(joinReason("Why?", "because")).toBe("Why? Because");
  });

  test("keeps case otherwise", () => {
    expect(joinReason("Posting spam links", "in #general")).toBe(
      "Posting spam links in #general",
    );
  });

  test("handles empty sides", () => {
    expect(joinReason("Base", "   ")).toBe("Base");
    expect(joinReason("", "extra")).toBe("extra");
    expect(joinReason("", "")).toBe("");
  });
});

describe("labels", () => {
  test("template label uses shortcut or Template prefix", () => {
    expect(buildTemplateLabel(spam)).toBe("!spam · Spamming in chat.");
    expect(buildTemplateLabel(noShortcut)).toBe("Template · Breaking rule 4");
  });

  test("recent label", () => {
    expect(buildRecentLabel(recent)).toBe("Recent · Raid account");
  });

  test("labels stay within 100 characters for long content", () => {
    const longest: TemplateLike = {
      id: "9",
      shortcut: "a".repeat(32),
      content: "x".repeat(3000),
    };

    for (const label of [
      buildTemplateLabel(longest),
      buildRecentLabel({ caseId: "1", reason: "y".repeat(3000) }),
      buildExpansionLabel(longest, "z".repeat(3000)),
      buildExpansionLabel(longest, ""),
    ]) {
      expect(label.length).toBeLessThanOrEqual(LABEL_MAX_LENGTH);
      expect(label.endsWith("…")).toBe(true);
    }
  });

  test("expansion label shows both parts when they fit", () => {
    expect(buildExpansionLabel(spam, "also in #general")).toBe(
      "!spam → Spamming in chat. + also in #general",
    );
  });

  test("expansion label cuts the template part first", () => {
    const label = buildExpansionLabel(longTemplate, "short extra");

    expect(label.length).toBeLessThanOrEqual(LABEL_MAX_LENGTH);
    expect(label.endsWith(" + short extra")).toBe(true);
    expect(label).toContain("…");
  });

  test("previewText collapses whitespace", () => {
    expect(previewText("a\n\n b", 10)).toBe("a b");
    expect(previewText("abcdef", 4)).toBe("abc…");
  });

  test("previewText never splits a surrogate pair", () => {
    const text = "ab" + "😀".repeat(10);

    for (let max = 2; max <= 10; max++) {
      const preview = previewText(text, max);
      expect(preview.length).toBeLessThanOrEqual(max);
      expect(preview).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
      expect(preview).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    }
    expect(previewText(text, 5)).toBe("ab😀…");
  });

  test("choice values", () => {
    expect(templateChoiceValue(spam)).toBe("!spam");
    expect(templateChoiceValue(noShortcut)).toBe("template:3");
    expect(recentChoiceValue(recent)).toBe("recent:42");
  });
});

describe("closestShortcut", () => {
  const shortcuts = ["spam", "spamlinks", "nsfw"];

  test("an adjacent swap counts as one edit", () => {
    expect(closestShortcut("!spma", shortcuts)).toBe("spam");
    expect(closestShortcut("nsf", shortcuts)).toBe("nsfw");
  });

  test("allows two edits only for longer input", () => {
    expect(closestShortcut("spamlinkz", shortcuts)).toBe("spamlinks");
    expect(closestShortcut("spmlnkks", shortcuts)).toBeNull();
    expect(closestShortcut("spamlnkz", shortcuts)).toBe("spamlinks");
  });

  test("returns null for short or distant input", () => {
    expect(closestShortcut("a", ["b", "ab"])).toBeNull();
    expect(closestShortcut("ns", shortcuts)).toBeNull();
    expect(closestShortcut("harassment", shortcuts)).toBeNull();
    expect(closestShortcut("!", shortcuts)).toBeNull();
  });

  test("breaks ties alphabetically", () => {
    expect(closestShortcut("abcd", ["abcf", "abce"])).toBe("abce");
  });
});

describe("expandReason", () => {
  test("exact tokens", () => {
    expect(expandReason("template:3", sources)).toEqual({
      text: "Breaking rule 4",
      template: { id: "3", shortcut: null },
      unknownShortcut: null,
      source: "token",
      unresolved: null,
    });
    expect(expandReason("recent:42", sources)).toEqual({
      text: "Raid account",
      template: null,
      unknownShortcut: null,
      source: "token",
      unresolved: null,
    });
    expect(expandReason("!spam", sources)).toEqual({
      text: "Spamming in chat.",
      template: { id: "1", shortcut: "spam" },
      unknownShortcut: null,
      source: "token",
      unresolved: null,
    });
  });

  test("shortcut token is case-insensitive", () => {
    expect(expandReason("  !SPAM ", sources).text).toBe("Spamming in chat.");
  });

  test("label prefix becomes the content and joins the remainder", () => {
    const result = expandReason(
      `${buildTemplateLabel(spam)} also in #general`,
      sources,
    );

    expect(result).toEqual({
      text: "Spamming in chat. Also in #general",
      template: { id: "1", shortcut: "spam" },
      unknownShortcut: null,
      source: "label",
      unresolved: null,
    });
  });

  test("recent label read-back", () => {
    const result = expandReason(`${buildRecentLabel(recent)}`, sources);

    expect(result.text).toBe("Raid account");
    expect(result.template).toBeNull();
    expect(result.source).toBe("label");
  });

  test("truncated label followed by extra text restores full content", () => {
    const label = buildTemplateLabel(longTemplate);
    expect(label.endsWith("…")).toBe(true);

    const result = expandReason(`${label} and more`, sources);

    expect(result.text).toBe(`${longTemplate.content} and more`);
    expect(result.source).toBe("label");
  });

  test("longest matching label wins", () => {
    const shortLabelSources = {
      templates: [
        { id: "10", shortcut: null, content: "Rule" },
        { id: "11", shortcut: null, content: "Rule one" },
      ],
      recents: [],
    };

    const result = expandReason("Template · Rule one extra", shortLabelSources);

    expect(result.template?.id).toBe("11");
    expect(result.text).toBe("Rule one extra");
  });

  test("label beats shortcut parsing", () => {
    const result = expandReason(buildTemplateLabel(spamLinks), sources);

    expect(result.source).toBe("label");
    expect(result.text).toBe("Posting spam links");
  });

  test("known shortcut with extra text", () => {
    expect(expandReason("!spam also in #general", sources)).toEqual({
      text: "Spamming in chat. Also in #general",
      template: { id: "1", shortcut: "spam" },
      unknownShortcut: null,
      source: "shortcut",
      unresolved: null,
    });
  });

  test("shortcut keeps multi-line extra text", () => {
    expect(expandReason("!spamlinks in\n#general", sources).text).toBe(
      "Posting spam links in\n#general",
    );
  });

  test("unknown shortcut keeps the raw input", () => {
    expect(expandReason("!nope something", sources)).toEqual({
      text: "!nope something",
      template: null,
      unknownShortcut: "nope",
      source: "none",
      unresolved: null,
    });
    expect(expandReason("!Nope", sources).unknownShortcut).toBe("nope");
  });

  test("invalid shortcut is not reported as unknown", () => {
    expect(expandReason("!!! wow", sources).unknownShortcut).toBeNull();
  });

  test("tokens that don't resolve are flagged", () => {
    for (const input of ["template:999", "recent:7"]) {
      expect(expandReason(` ${input} `, sources)).toEqual({
        text: input,
        template: null,
        unknownShortcut: null,
        source: "none",
        unresolved: { kind: "token", input },
      });
    }
  });

  test("a stale label is flagged instead of expanding the shortcut", () => {
    const changed = { ...spam, content: "New content" };
    const input = "!spam · Spamming in chat. extra";

    expect(expandReason(input, { templates: [changed], recents: [] })).toEqual({
      text: input,
      template: null,
      unknownShortcut: null,
      source: "none",
      unresolved: { kind: "stale_label", input },
    });
    expect(expandReason("Recent · Old raid", sources).unresolved?.kind).toBe(
      "stale_label",
    );
    expect(expandReason("Template · Gone", sources).unresolved?.kind).toBe(
      "stale_label",
    );
  });

  test("edited autocomplete choice names are refused, not saved", () => {
    const edited = [
      `${buildExpansionLabel(spam, "again")} and more`,
      'Use "raid" as typed and more',
      "No template !spma, it will be used as typed",
      "Did you mean !spam · Spamming in chat. and more",
      "Tip: make templates in /reason-templates, then type !shortcut",
    ];

    for (const input of edited) {
      expect(expandReason(input, sources).unresolved?.kind).toBe("stale_label");
    }
  });

  test("choice names with a trimmed tail are still refused", () => {
    for (const input of [
      "No template !spma, it will be used as",
      "Did you mean !spam",
      "Tip: make templates in /reason",
    ]) {
      expect(expandReason(input, sources).unresolved?.kind).toBe("stale_label");
    }
  });

  test("typed reasons that only resemble a choice name stay plain text", () => {
    for (const input of [
      "Tip: don't post links",
      "Did you mean that?",
      "No template for this, sorry",
    ]) {
      expect(expandReason(input, sources)).toEqual({
        text: input,
        template: null,
        unknownShortcut: null,
        source: "none",
        unresolved: null,
      });
    }
  });

  test("malformed tokens are unresolved instead of saved", () => {
    expect(expandReason("template:", sources).unresolved?.kind).toBe("token");
    expect(
      expandReason("recent:1234567890123456789", sources).unresolved?.kind,
    ).toBe("token");
  });

  test("two different reasons with the same longest label are ambiguous", () => {
    const long = "x".repeat(200);
    const input = `${buildRecentLabel({ caseId: "1", reason: `${long} a` })} more`;

    const result = expandReason(input, {
      templates: [],
      recents: [
        { caseId: "1", reason: `${long} a` },
        { caseId: "2", reason: `${long} b` },
      ],
    });

    expect(result.unresolved).toEqual({ kind: "ambiguous_label", input });
    expect(result.text).toBe(input);
  });

  test("a label must end at a word boundary", () => {
    const result = expandReason("Template · Rules violated", {
      templates: [{ id: "1", shortcut: null, content: "Rule" }],
      recents: [],
    });

    expect(result.text).toBe("Template · Rules violated");
    expect(result.source).toBe("none");
  });

  test("plain text passes through trimmed", () => {
    expect(expandReason("  just text ", sources)).toEqual({
      text: "just text",
      template: null,
      unknownShortcut: null,
      source: "none",
      unresolved: null,
    });
  });

  test("built labels and values round-trip to the content", () => {
    for (const template of sources.templates) {
      expect(expandReason(buildTemplateLabel(template), sources).text).toBe(
        template.content,
      );
      expect(expandReason(templateChoiceValue(template), sources).text).toBe(
        template.content,
      );
    }

    expect(expandReason(recentChoiceValue(recent), sources).text).toBe(
      recent.reason,
    );
  });
});
