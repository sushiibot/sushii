import { describe, expect, test } from "bun:test";

import type { ReasonTemplate } from "@/features/moderation/reason-templates/domain/ReasonTemplate";

import { buildReasonEditModal, buildReasonEditTitle } from "./reasonEditModal";

const TEMPLATE: ReasonTemplate = {
  id: "11",
  guildId: "187450744427773963",
  shortcut: "spam",
  content: "Spamming in channels (rule 3).",
  contentKey: "k",
  createdBy: "150443906511667200",
  createdAt: new Date(),
  updatedAt: null,
  useCount: 3,
  lastUsedAt: null,
};

const emojis = { history: "<:history:1400000000000000200>" };

interface Component {
  type: number;
  content?: string;
  label?: string;
  component?: { custom_id: string; required?: boolean };
}

function build(
  currentReason: string | null,
  dmTo: string | null,
  templates: ReasonTemplate[] = [TEMPLATE],
) {
  return buildReasonEditModal({
    customId: "cid",
    title: buildReasonEditTitle(["4822", "4823"], null),
    currentReason,
    formData: { last: null, templates },
    emojis,
    dmTo,
  }).toJSON() as unknown as { title: string; components: Component[] };
}

describe("buildReasonEditTitle", () => {
  test("one case names the target, several count the cases", () => {
    expect(buildReasonEditTitle(["4822"], "spambot")).toBe(
      "Reason for #4822 · spambot",
    );
    expect(buildReasonEditTitle(["4822", "4823"], "spambot")).toBe(
      "Reason for 2 cases",
    );
  });

  test("fits 45 characters for long names and case IDs", () => {
    const title = buildReasonEditTitle(["99999999"], "n".repeat(80));
    expect(title.length).toBeLessThanOrEqual(45);
    expect(title).toStartWith("Reason for #99999999 · ");

    expect(
      buildReasonEditTitle(["9".repeat(60)], "x").length,
    ).toBeLessThanOrEqual(45);
  });
});

describe("buildReasonEditModal", () => {
  test("editing several cases with live DMs", () => {
    const modal = build("Old reason", "2 users");

    expect(modal.title).toBe("Reason for 2 cases");
    expect(modal.components[0]?.content).toBe(
      "**Current reason**\n> Old reason",
    );
    expect(
      modal.components.slice(1).map((c) => c.component?.custom_id),
    ).toEqual(["reason_template", "reason", "reason_options"]);
    expect(modal.components[2]?.label).toBe("New reason or extra details");
    expect(modal.components[2]?.component?.required).toBe(false);
  });

  test("setting a reason with no DM uses the save checkbox", () => {
    const modal = build(null, null);

    expect(modal.components.map((c) => c.component?.custom_id)).toEqual([
      "reason_template",
      "reason",
      "save_as_template",
    ]);
  });

  test("nothing to pick: no dropdown and the reason is required", () => {
    const modal = build(null, null, []);

    expect(modal.components.map((c) => c.component?.custom_id)).toEqual([
      "reason",
      "save_as_template",
    ]);
    expect(modal.components[0]?.label).toBe("Reason");
    expect(modal.components[0]?.component?.required).toBe(true);
  });
});
