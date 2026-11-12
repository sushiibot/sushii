import { describe, expect, test } from "bun:test";
import type { APIMessageTopLevelComponent } from "discord.js";
import { ComponentType } from "discord.js";

import { ACTION_RESPONSE_IDS } from "@/features/moderation/actions/presentation/views/ModerationActionView";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  SUGGESTED_OPTIONS_MAX,
  buildAddProofModal,
} from "@/features/moderation/shared/presentation/proof/addProofModal";

import { suggestedOptions } from "./modalSuggestions";
import {
  addedText,
  beforeAction,
  linksFromAddedText,
  nothingAddedText,
  orderSuggestions,
  plainSnippet,
  responseBlockText,
  summarize,
  undoFailedText,
  undoneText,
} from "./suggestionText";
import {
  ACTION_TIME,
  GENERAL,
  automodSuggestion,
  deletedSuggestion,
  recentSuggestion,
} from "./testFixtures";
import {
  buildAddedMessage,
  buildNothingLeft,
  buildPicker,
  buildResponseSuggestionBlock,
  pickerWithSelection,
  selectedInPicker,
} from "./views";

const FP = "0a1b2c3d";
const suggestions = orderSuggestions([
  recentSuggestion(),
  automodSuggestion(),
  deletedSuggestion(),
]);

function json(value: unknown): string {
  return JSON.stringify(value);
}

function pickerPayload(withImages: boolean) {
  return buildPicker(
    {
      caseId: "4822",
      fingerprint: FP,
      targetId: "912345678901234567",
      targetName: "spambot",
      actionType: ActionType.Ban,
      items: suggestions.map((suggestion, i) => ({
        suggestion,
        channelName: "general",
        image: withImages
          ? { name: `proof-${i}.png`, png: Buffer.from([i]) }
          : null,
      })),
      addOtherProofId: "caseProof/add/4822",
    },
    new Set(suggestions.flatMap((s, i) => (s.kind !== "recent" ? [i] : []))),
  );
}

function postedOf(message: { components: { toJSON(): unknown }[] }) {
  return message.components.map((c) =>
    c.toJSON(),
  ) as APIMessageTopLevelComponent[];
}

describe("orderSuggestions", () => {
  test("newest first, stable for equal times", () => {
    expect(suggestions.map((s) => s.kind)).toEqual([
      "deleted",
      "automod",
      "recent",
    ]);
    const tied = [deletedSuggestion({ kind: "recent" }), deletedSuggestion()];
    expect(orderSuggestions(tied).map((s) => s.kind)).toEqual(
      orderSuggestions([...tied].reverse()).map((s) => s.kind),
    );
  });
});

describe("response suggestion block", () => {
  test("shows counts, channels and times but no message text", () => {
    const block = buildResponseSuggestionBlock({
      caseId: "4822",
      fingerprint: FP,
      suggestions,
      targetName: "spam_bot",
      actionType: ActionType.Ban,
    });
    const text = json(block);

    expect(text).not.toContain("secret deleted spam text");
    expect(text).not.toContain("FREE NITRO");
    expect(text).not.toContain("anyone want free nitro");
    expect(text).not.toContain("attachment://");
    expect(block.some((c) => c.type === ComponentType.MediaGallery)).toBe(
      false,
    );

    const content = responseBlockText({
      suggestions,
      targetName: "spam_bot",
      actionType: ActionType.Ban,
    });
    expect(content).toBe(
      [
        "**💡 3 suggestions** · from spam\\_bot's last activity before the ban",
        `> 🗑️ **4 deleted messages** in <#${GENERAL}> · <t:1793098380:R> – <t:1793098740:R>`,
        "> 🤖 **AutoMod alert** · Scam links · <t:1793098680:R>",
        "> 💬 **2 messages** in <#1029384756102938403> · still visible · <t:1793091000:R> – <t:1793091600:R>",
        "-# Adds up to 7 links. Review shows previews only to you.",
      ].join("\n"),
    );

    const row = block.find((c) => c.id === ACTION_RESPONSE_IDS.suggestionsRow);
    expect(json(row)).toContain('"label":"Add all 3"');
    expect(json(row)).toContain(
      '"custom_id":"proof/suggest/add/4822/0a1b2c3d"',
    );
    expect(json(row)).toContain(
      '"custom_id":"proof/suggest/review/4822/0a1b2c3d"',
    );
  });

  test("says last 10 of N and an exact count for live messages", () => {
    const text = responseBlockText({
      suggestions: [
        recentSuggestion({ totalInWindow: 214 }),
        recentSuggestion({ deletedCount: 1 }),
      ],
      targetName: "spambot",
      actionType: ActionType.Kick,
    });
    expect(text).toContain("**Last 2 of 214 messages**");
    expect(text).toContain("· 1 deleted ·");
    expect(text).toContain("before the kick");
    expect(text).toContain("-# Adds up to 4 links.");

    expect(
      responseBlockText({
        suggestions: [recentSuggestion()],
        targetName: "spambot",
        actionType: ActionType.Warn,
      }),
    ).toContain("-# Adds 2 links.");
  });
});

describe("review picker", () => {
  test("puts each preview in a gallery backed by an uploaded file", () => {
    const picker = pickerPayload(true);
    const posted = json(postedOf(picker));

    expect(picker.files.map((f) => f.name)).toEqual([
      "proof-0.png",
      "proof-1.png",
      "proof-2.png",
    ]);
    expect(posted).toContain("attachment://proof-0.png");
    expect(posted).toContain("Saves their message log links");
    expect(posted).toContain("Saves the alert link in <#1029384756102938405>");
    expect(posted).toContain('"label":"Add 2"');
  });

  test("defaults AutoMod and deleted, leaves still-visible unchecked", () => {
    const posted = postedOf(pickerPayload(false));
    expect(selectedInPicker(posted)).toEqual(["0", "1"]);
    expect(json(posted)).not.toContain("attachment://");
  });

  test("keeps within Discord's component limit with 10 suggestions", () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      deletedSuggestion({ channelId: `10293847561029384${10 + i}` }),
    );
    const picker = buildPicker(
      {
        caseId: "4822",
        fingerprint: FP,
        targetId: "912345678901234567",
        targetName: "spambot",
        actionType: ActionType.Ban,
        items: ten.map((suggestion, i) => ({
          suggestion,
          channelName: "general",
          image: { name: `proof-${i}.png`, png: Buffer.from([i]) },
        })),
        addOtherProofId: "caseProof/add/4822",
      },
      new Set([0]),
    );
    let count = 0;
    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") {
        return;
      }
      const c = node as {
        type?: number;
        components?: unknown[];
        items?: unknown[];
        accessory?: unknown;
      };
      if (typeof c.type === "number") {
        count += 1;
      }
      c.components?.forEach(visit);
      c.items?.forEach(() => (count += 1));
      visit(c.accessory);
    };
    postedOf(picker).forEach(visit);
    expect(count).toBeLessThanOrEqual(40);
  });

  test("changing the select updates defaults and the Add count", () => {
    const posted = postedOf(pickerPayload(true));
    const updated = pickerWithSelection(posted, ["2"]);
    expect(updated).not.toBeNull();
    const after = (updated?.components ??
      []) as unknown as APIMessageTopLevelComponent[];
    expect(selectedInPicker(after)).toEqual(["2"]);
    expect(json(after)).toContain('"label":"Add 1"');
    expect(json(after)).toContain("attachment://proof-0.png");

    const none = pickerWithSelection(posted, []);
    expect(json(none)).toContain('"label":"Add 0"');
    expect(json(none)).toContain('"disabled":true');
  });

  test("nothing left keeps Add other proof", () => {
    const message = buildNothingLeft("4822", "caseProof/add/4822");
    const text = json(postedOf(message));
    expect(text).toContain("Nothing to suggest anymore.");
    expect(text).toContain('"custom_id":"caseProof/add/4822"');
    expect(selectedInPicker(postedOf(message))).toBeNull();
  });
});

describe("Added message and undo text", () => {
  const resolved = [
    {
      links: [
        {
          url: "https://discord.com/channels/1/2/3",
          source: "log" as const,
          channelId: "2",
          messageIds: ["a", "b"],
        },
        {
          url: "https://discord.com/channels/1/2/4",
          source: "log" as const,
          channelId: "2",
          messageIds: ["c"],
        },
      ],
      pending: ["d", "e"],
      skipped: [{ messageId: "f", reason: "deleted_not_logged" as const }],
    },
  ];

  test("reports links, pending, skipped and placement", () => {
    const summary = summarize("4822", resolved, 1, "pending");
    const text = addedText(summary);
    expect(text).toBe(
      [
        "✅ Added **1 suggestion** (2 links) to **Case #4822**",
        "-# 2 deleted messages are still being logged. Add them later from **Suggested proof**.",
        "-# 1 deleted message was skipped: its message log post never arrived.",
        "-# Saved, but not shown on the mod log entry yet.",
      ].join("\n"),
    );
    expect(linksFromAddedText(text)).toBe(2);

    const message = buildAddedMessage(text, {
      caseId: "4822",
      batchId: "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b",
    });
    expect(json(postedOf(message))).toContain(
      '"custom_id":"proof/suggest/undo/4822/3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b"',
    );
    expect(addedText({ ...summary, shown: "not_shown" })).toContain(
      "Saved, but it couldn't be shown on the mod log entry.",
    );
  });

  test("says nothing was added when no link resolved", () => {
    const summary = summarize(
      "4822",
      [
        {
          links: [],
          pending: [],
          skipped: [{ messageId: "x", reason: "unchecked" }],
        },
      ],
      0,
      null,
    );
    expect(nothingAddedText(summary)).toBe(
      [
        "Nothing was added to **Case #4822**: none of these messages could be linked.",
        "-# 1 message was skipped: sushii couldn't check it. Try again later.",
      ].join("\n"),
    );
  });

  test("says nothing new was added when some picks were already saved", () => {
    const summary = {
      ...summarize(
        "4822",
        [{ links: [], pending: ["p"], skipped: [] }],
        0,
        null,
      ),
      alreadyAdded: 1,
    };
    expect(nothingAddedText(summary)).toStartWith(
      "Nothing new was added to **Case #4822**.\n-# 1 already added.",
    );
  });

  test("undo outcomes", () => {
    expect(undoneText("4822", 6)).toBe(
      "Undone. Removed 6 links from Case #4822.",
    );
    expect(undoneText("4822", null)).toBe(
      "Undone. Removed the suggested proof from Case #4822.",
    );
    expect(undoFailedText(2, 1)).toBe(
      "Removed 2 of 3; 1 couldn't be removed. Try again.",
    );
  });
});

describe("Add proof form suggestions", () => {
  test("lists at most 10 text-only options with strong matches checked", () => {
    const many = Array.from({ length: 12 }, () => recentSuggestion());
    const options = suggestedOptions({
      moderationCase: { actionTime: ACTION_TIME } as never,
      suggestions: [automodSuggestion(), deletedSuggestion(), ...many],
      fingerprint: FP,
      channelName: () => "general",
    });
    const modal = buildAddProofModal({
      customId: `caseProof/form/1/${FP}`,
      caseIds: ["4822"],
      userName: "spambot",
      existingFiles: 0,
      suggested: options,
    }).toJSON();
    const text = json(modal);
    const group = text.match(/"type":22[^\]]*\]/);
    expect(group).not.toBeNull();

    const checkbox = (
      modal.components as unknown as {
        type: number;
        component?: {
          type: number;
          options: { label: string; description?: string; default?: boolean }[];
        };
      }[]
    ).find((c) => c.component?.type === ComponentType.CheckboxGroup)
      ?.component ?? { type: 0, options: [] };
    expect(checkbox.options.length).toBe(SUGGESTED_OPTIONS_MAX);
    expect(checkbox.options[0]).toMatchObject({
      label: "🤖 AutoMod alert · Scam links · 2m before",
      description: "FREE NITRO 🎁 discord-nitro.gift/claim",
      default: true,
    });
    expect(checkbox.options[1].label).toBe(
      "🗑️ 4 deleted messages · #general · 1–7m before",
    );
    expect(checkbox.options[1].default).toBe(true);
    expect(checkbox.options[2].label).toBe(
      "💬 2 messages · #general · still visible · 2h before",
    );
    expect(checkbox.options[2].default).toBeFalsy();
    for (const option of checkbox.options) {
      expect(Array.from(option.label).length).toBeLessThanOrEqual(100);
    }
    expect(text).toContain("Suggestions save as links.");
    expect(text.indexOf('"type":22')).toBeLessThan(
      text.indexOf('"custom_id":"text"'),
    );
  });

  test("helpers", () => {
    expect(plainSnippet("a\\*b\\_c")).toBe("a*b_c");
    expect(beforeAction(recentSuggestion(), ACTION_TIME)).toBe("2h before");
  });
});
