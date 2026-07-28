import { describe, expect, it } from "bun:test";
import { ComponentType, ContainerBuilder } from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import {
  HISTORY_ACTION_EMOJIS,
  formatModerationCase,
} from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModViewResult } from "@/features/moderation/mod-view/application/ModViewService";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import type { UserInfo } from "@/features/moderation/shared/domain/types/UserInfo";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { makeAltIdentity } from "@/test/fixtures/altIdentity";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import { MODVIEW_CUSTOM_IDS } from "../../customIds";
import type { ModViewTabContentOptions } from "../ModViewMessageBuilder";
import {
  addHistoryTabContent,
  buildHistoryTabPages,
  deriveHistoryTabView,
} from "./HistoryTabBuilder";

const GUILD_ID = "111111111111111111";
const TARGET_ID = "222222222222222222";
const ALT_ID = "333333333333333333";

const emojis = Object.fromEntries(
  HISTORY_ACTION_EMOJIS.map((name) => [name, `:${name}:`]),
) as EmojiMap<typeof HISTORY_ACTION_EMOJIS>;

const userInfo: UserInfo = {
  id: TARGET_ID,
  username: "target",
  avatarURL: "https://example.com/avatar.png",
  joinedAt: null,
  isBot: false,
};

function extractTextContents(container: ContainerBuilder): string[] {
  const texts: string[] = [];

  function walk(node: Record<string, unknown>): void {
    if (
      node.type === ComponentType.TextDisplay &&
      typeof node.content === "string"
    ) {
      texts.push(node.content);
    }
    if (Array.isArray(node.components)) {
      for (const child of node.components as Record<string, unknown>[]) {
        walk(child);
      }
    }
    if (node.accessory && typeof node.accessory === "object") {
      walk(node.accessory as Record<string, unknown>);
    }
  }

  walk(container.toJSON() as unknown as Record<string, unknown>);
  return texts;
}

/** Recursively find every button `custom_id` in the rendered container. */
function extractButtonCustomIds(container: ContainerBuilder): string[] {
  const ids: string[] = [];

  function walk(node: Record<string, unknown>): void {
    if (
      node.type === ComponentType.Button &&
      typeof node.custom_id === "string"
    ) {
      ids.push(node.custom_id);
    }
    if (Array.isArray(node.components)) {
      for (const child of node.components as Record<string, unknown>[]) {
        walk(child);
      }
    }
    if (node.accessory && typeof node.accessory === "object") {
      walk(node.accessory as Record<string, unknown>);
    }
  }

  walk(container.toJSON() as unknown as Record<string, unknown>);
  return ids;
}

function makeCase(overrides: {
  caseId: string;
  userId?: string;
}): ModerationCase {
  return makeModerationCase({
    guildId: GUILD_ID,
    caseId: overrides.caseId,
    actionType: ActionType.Warn,
    userId: overrides.userId ?? TARGET_ID,
    executorId: null,
    reason: null,
  });
}

function baseOptions(
  data: ModViewResult,
  overrides: Partial<ModViewTabContentOptions> = {},
): ModViewTabContentOptions {
  return {
    data,
    disabled: false,
    user: { id: TARGET_ID, username: "target", globalName: null } as never,
    member: null,
    guildId: GUILD_ID,
    emojis,
    ...overrides,
  };
}

function render(
  data: ModViewResult,
  overrides: Partial<ModViewTabContentOptions> = {},
): { texts: string[]; buttonIds: string[] } {
  const container = new ContainerBuilder();
  addHistoryTabContent(container, baseOptions(data, overrides));
  return {
    texts: extractTextContents(container),
    buttonIds: extractButtonCustomIds(container),
  };
}

function makeData(overrides: {
  moderationHistory: ModerationCase[];
  linkedIdentity?: ModViewResult["history"]["linkedIdentity"];
}): ModViewResult {
  return {
    userInfo,
    history: {
      userInfo,
      moderationHistory: overrides.moderationHistory,
      totalCases: overrides.moderationHistory.length,
      linkedIdentity: overrides.linkedIdentity ?? null,
    },
    lookup: null,
    names: { userInfo, history: [], eligibilityDenied: false },
    identity: null,
    standing: null,
  };
}

describe("HistoryTabBuilder — 7.7 linked-account filter", () => {
  const linkedIdentity = makeAltIdentity({
    guildId: GUILD_ID,
    memberIds: [TARGET_ID, ALT_ID],
  });

  function makeFilterData(): ModViewResult {
    return makeData({
      moderationHistory: [
        makeCase({ caseId: "1", userId: TARGET_ID }),
        makeCase({ caseId: "2", userId: ALT_ID }),
        makeCase({ caseId: "3", userId: TARGET_ID }),
      ],
      linkedIdentity,
    });
  }

  it("shows the attribution mention and the filter control when combined (default)", () => {
    const { texts, buttonIds } = render(makeFilterData());
    const body = texts.join("\n");

    expect(body).toContain(`<@${ALT_ID}>`);
    expect(buttonIds).toContain(MODVIEW_CUSTOM_IDS.historyAlts);
  });

  it("drops the attribution mention and states the hidden count when filtered", () => {
    const { texts } = render(makeFilterData(), { includeAlts: false });
    const body = texts.join("\n");

    // Filtered to the viewed account: the alt's mention must not leak in,
    // and the target's own mention pill is also dropped since it is now
    // redundant with the single-account view.
    expect(body).not.toContain(`<@${ALT_ID}>`);
    expect(body).not.toContain(`<@${TARGET_ID}>`);

    // 2 of the target's own cases visible, 1 hidden on the other linked account.
    expect(body).toContain("2 cases on this account");
    expect(body).toContain("1 hidden on 1 linked account");
  });

  it("restores the combined view and original count when the filter is toggled back off", () => {
    const filtered = render(makeFilterData(), { includeAlts: false });
    const restored = render(makeFilterData(), { includeAlts: true });

    expect(filtered.texts.join("\n")).not.toContain(`<@${ALT_ID}>`);
    expect(restored.texts.join("\n")).toContain(`<@${ALT_ID}>`);
    expect(restored.texts[0]).toBe("-# 3 cases across 2 accounts");
  });

  it("omits the filter control entirely when the target has no linked identity", () => {
    const { buttonIds, texts } = render(
      makeData({ moderationHistory: [makeCase({ caseId: "1" })] }),
    );

    expect(buttonIds).not.toContain(MODVIEW_CUSTOM_IDS.historyAlts);
    expect(texts[0]).not.toContain("hidden");
  });

  /**
   * "Resets to page 1" at the collector layer means: toggling the filter
   * recomputes `deriveHistoryTabView` from scratch and the render falls
   * back to `pages[0]` of that fresh result — there is no stale page index
   * carried across the toggle for this builder to accidentally reuse.
   * `ModViewSession`'s collector wiring (outside this file's scope) is what
   * actually resets the paginator's page cursor; this pins the presentation
   * layer's half of that contract.
   */
  it("renders the fresh first page of the filtered set when no page override is supplied", () => {
    const data = makeFilterData();
    const filteredView = deriveHistoryTabView(
      data.history,
      TARGET_ID,
      emojis,
      false,
    );

    const { texts } = render(data, { includeAlts: false });
    const expectedBody = filteredView.pages[0]
      .map((c) =>
        formatModerationCase(c, emojis, filteredView.showTargetMention, true),
      )
      .join("\n");

    expect(texts.at(-1)).toBe(expectedBody);
  });
});

describe("HistoryTabBuilder — 7.8a ordering", () => {
  it("does not state an ordering sentence in the scope block", () => {
    const cases = Array.from({ length: 5 }, (_, i) =>
      makeCase({ caseId: `${i + 1}` }),
    );
    const { texts } = render(makeData({ moderationHistory: cases }));

    expect(texts[0]).not.toMatch(/oldest|newest|order/i);
  });

  it("pages newest-first: page 1 holds the most recent record", () => {
    // Ascending oldest→newest input, as `UserHistoryResult.moderationHistory`
    // is documented to be. A near-max reason (1024-char cap) on each case
    // keeps at most a few per bin, forcing more than one page without
    // depending on an exact per-page count.
    const bigReason = "x".repeat(1000);
    const cases = Array.from({ length: 12 }, (_, i) =>
      makeModerationCase({
        guildId: GUILD_ID,
        caseId: `${i + 1}`,
        actionType: ActionType.Ban,
        userId: TARGET_ID,
        executorId: null,
        reason: bigReason,
      }),
    );

    const pages = buildHistoryTabPages(cases, emojis, false);

    expect(pages.length).toBeGreaterThan(1);
    // Page 1 (index 0) starts with the most recent case — the highest case ID.
    expect(pages[0].at(-1)?.caseId).toBe("12");
    // The last page reaches back to the oldest case.
    expect(pages.at(-1)?.[0].caseId).toBe("1");
  });

  it("orders the oldest record at the top within a page", () => {
    const cases = Array.from({ length: 150 }, (_, i) =>
      makeCase({ caseId: `${i + 1}` }),
    );

    const pages = buildHistoryTabPages(cases, emojis, false);
    expect(pages.length).toBeGreaterThan(1);

    const firstPage = pages[0];
    expect(firstPage.length).toBeGreaterThan(1);

    // Within page 1, case IDs ascend top-to-bottom (oldest at top), and the
    // page's last (newest) entry is the overall newest case, 150.
    const ids = firstPage.map((c) => Number(c.caseId));
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
    expect(ids.at(-1)).toBe(150);

    // Page 1 as a whole holds more recent cases than page 2.
    const secondPage = pages[1];
    expect(Number(firstPage[0].caseId)).toBeGreaterThan(
      Number(secondPage.at(-1)?.caseId),
    );
  });
});
