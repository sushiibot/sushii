import { describe, expect, test } from "bun:test";
import type {
  APIContainerComponent,
  APITextDisplayComponent,
} from "discord.js";
import { MessageFlags } from "discord.js";

import type { ReasonTemplateError } from "../../application/ReasonTemplateService";
import type { ReasonTemplate } from "../../domain/ReasonTemplate";
import {
  buildReasonTemplateErrorMessage,
  describeReasonTemplateError,
} from "./reasonTemplateErrors";

const emojis = { fail: "<:fail:1400000000000000001>" };

function template(overrides: Partial<ReasonTemplate> = {}): ReasonTemplate {
  return {
    id: "11",
    guildId: "1029384756102938475",
    shortcut: "spam",
    content: "Spamming in channels (rule 3).",
    contentKey: "key",
    createdBy: "238381427315195904",
    createdAt: new Date("2026-09-17T12:00:00Z"),
    updatedAt: null,
    useCount: 0,
    lastUsedAt: null,
    ...overrides,
  };
}

describe("describeReasonTemplateError", () => {
  test.each<[ReasonTemplateError, string]>([
    [
      { code: "shortcut_taken", shortcut: "spam", owner: template() },
      "`!spam` is already the shortcut for:\n> Spamming in channels (rule 3).\nPick a different shortcut, or edit that one in `/reason-templates`.",
    ],
    [
      { code: "shortcut_taken", shortcut: "spam", owner: null },
      "`!spam` is already used by another template. Pick a different shortcut.",
    ],
    [
      { code: "invalid_shortcut", shortcut: "spam bot" },
      "`spam bot` can't be a shortcut. Use letters, numbers, `-` and `_`, with no spaces.",
    ],
    [
      { code: "duplicate", existing: template() },
      "This text is already the template `!spam`.",
    ],
    [
      { code: "duplicate", existing: template({ shortcut: null }) },
      "This text is already a template (no shortcut). Find it in the list to add one.",
    ],
    [
      { code: "limit_reached", limit: 100 },
      "This server has 100 templates, the maximum. Delete one in `/reason-templates` to add more.",
    ],
    [
      { code: "too_long", length: 3042, max: 3000 },
      "The template is 3,042 characters; the limit is 3,000. Shorten it by 42 characters.",
    ],
    [{ code: "empty" }, "The template text can't be empty."],
    [{ code: "not_found" }, "That template was deleted."],
  ])("%o", (error, expected) => {
    expect(describeReasonTemplateError(error)).toBe(expected);
  });

  test("shortcut-taken quotes a long owner text on one line", () => {
    const text = describeReasonTemplateError({
      code: "shortcut_taken",
      shortcut: "spam",
      owner: template({ content: "word\n".repeat(100) }),
    });
    const quoted = text.split("\n")[1];

    expect(quoted.startsWith("> word word")).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(92);
  });

  test("backticks in an invalid shortcut can't break the code span", () => {
    const text = describeReasonTemplateError({
      code: "invalid_shortcut",
      shortcut: "a`b",
    });

    expect(text.startsWith("`aˋb`")).toBe(true);
  });
});

describe("buildReasonTemplateErrorMessage", () => {
  test("is an ephemeral v2 reply with the fail emoji", () => {
    const message = buildReasonTemplateErrorMessage(
      { code: "not_found" },
      emojis,
    );
    const [root] = message.components as { toJSON(): APIContainerComponent }[];
    const text = root.toJSON().components[0] as APITextDisplayComponent;

    expect(message.flags).toBe(
      MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    );
    expect(text.content).toBe(`${emojis.fail} That template was deleted.`);
  });
});
