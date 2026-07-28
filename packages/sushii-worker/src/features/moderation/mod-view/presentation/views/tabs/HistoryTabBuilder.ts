import {
  ButtonBuilder,
  ButtonStyle,
  type ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type { EmojiMap } from "@/features/bot-emojis";
import type { UserHistoryResult } from "@/features/moderation/cases/application/HistoryUserService";
import {
  type HISTORY_ACTION_EMOJIS,
  formatModerationCase,
  spansMultipleUsers,
} from "@/features/moderation/cases/presentation/views/HistoryView";
import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { chunkItems } from "@/shared/presentation/packLines";
import { countWithNoun } from "@/shared/presentation/pluralize";

import { MODVIEW_CUSTOM_IDS } from "../../customIds";
import type { ModViewTabContentBuilder } from "../ModViewMessageBuilder";
import { addScopeBlock, addStateLine } from "../components/ModViewChrome";

/**
 * Bins the target's cases (already filtered by the caller, e.g. by
 * `includeAlts`) into pages sized for one Text Display each, newest-first by
 * page, oldest-at-top within a page — mirroring `HistoryCommand`'s existing
 * `buildHistoryPages` construction but rendering with the tab's
 * preposition-dropped case format.
 */
export function buildHistoryTabPages(
  cases: ModerationCase[],
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
  showTargetMention: boolean,
): ModerationCase[][] {
  // `cases` (from UserHistoryResult.moderationHistory) is oldest-first
  // ascending by case ID; reverse so page 1 bins the most recent cases.
  const casesNewestFirst = [...cases].reverse();

  const bins = chunkItems(casesNewestFirst, (c) =>
    formatModerationCase(c, emojis, showTargetMention, true),
  );

  return bins.map((bin) => [...bin].reverse());
}

export interface HistoryTabView {
  /** False when the identity has at most one member — the filter is then never offered. */
  hasLinkedIdentity: boolean;
  /** The effective filter state: forced true when there is nothing to filter. */
  includeAlts: boolean;
  filteredCases: ModerationCase[];
  showTargetMention: boolean;
  pages: ModerationCase[][];
}

/**
 * The single derivation of the History tab's filter → attribution → page
 * chunking chain. Both the content builder and the pagination wiring call
 * this: computing it twice would let the rendered page and the paginator's
 * page boundaries drift apart silently.
 */
export function deriveHistoryTabView(
  history: UserHistoryResult,
  viewedUserId: string,
  emojis: EmojiMap<typeof HISTORY_ACTION_EMOJIS>,
  includeAltsPreference: boolean | undefined,
): HistoryTabView {
  const hasLinkedIdentity =
    !!history.linkedIdentity && history.linkedIdentity.members.length > 1;
  const includeAlts = !hasLinkedIdentity || (includeAltsPreference ?? true);

  const filteredCases = includeAlts
    ? history.moderationHistory
    : history.moderationHistory.filter((c) => c.userId === viewedUserId);

  // Recomputed from the filtered set, so the `on <@id>` attribution vanishes
  // once only one account's cases remain.
  const showTargetMention = includeAlts && spansMultipleUsers(filteredCases);

  return {
    hasLinkedIdentity,
    includeAlts,
    filteredCases,
    showTargetMention,
    pages: buildHistoryTabPages(filteredCases, emojis, showTargetMention),
  };
}

/**
 * The `-# …` scope text — total plus merge scope, deliberately never the sort
 * order (4.7a): pages run newest-first while rows within a page run
 * oldest-at-top, so any ordering sentence here would contradict what the eye
 * sees. Per-entry relative timestamps already make ordering self-evident.
 */
function buildScopeText(
  history: UserHistoryResult,
  hasLinkedIdentity: boolean,
  includeAlts: boolean,
  filteredCount: number,
): string {
  const { totalCases, linkedIdentity } = history;

  if (!hasLinkedIdentity || !linkedIdentity) {
    return countWithNoun(totalCases, "case");
  }

  if (includeAlts) {
    return `${countWithNoun(totalCases, "case")} across ${countWithNoun(linkedIdentity.members.length, "account")}`;
  }

  // 4.7b: one merged line, not three separate whispers.
  const hidden = totalCases - filteredCount;
  const hiddenAccounts = linkedIdentity.members.length - 1;
  return `${countWithNoun(filteredCount, "case")} on this account · ${hidden} hidden on ${countWithNoun(hiddenAccounts, "linked account")}`;
}

function addScopeSection(
  container: ContainerBuilder,
  text: string,
  buttonLabel: string,
  disabled: boolean,
): void {
  const content = text
    .split("\n")
    .map((line) => `-# ${line}`)
    .join("\n");

  const section = new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(MODVIEW_CUSTOM_IDS.historyAlts)
        .setLabel(buttonLabel)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    );

  container.addSectionComponents(section);
}

/**
 * History tab content: scope block (Section w/ alt-filter accessory when a
 * linked identity exists) → body of case entries. Never an overflow line —
 * History is paginated (design D3/D7's `chunkItems`) and drops nothing; the
 * pagination wiring owns page turns and must rebuild the full frame via
 * `createModViewMessage` on every one (chrome outside the returned container
 * is wiped by the paginator's `update()`).
 */
export const addHistoryTabContent: ModViewTabContentBuilder = (
  container,
  options,
) => {
  const { data, disabled, emojis } = options;
  const { history } = data;

  if (history.totalCases === 0) {
    addStateLine(
      container,
      "No moderation cases found",
      "This server has no moderation history for this user.",
    );
    return;
  }

  const {
    hasLinkedIdentity,
    includeAlts,
    filteredCases,
    showTargetMention,
    pages,
  } = deriveHistoryTabView(
    history,
    data.userInfo.id,
    emojis,
    options.includeAlts,
  );

  const scopeText = buildScopeText(
    history,
    hasLinkedIdentity,
    includeAlts,
    filteredCases.length,
  );

  if (hasLinkedIdentity) {
    addScopeSection(
      container,
      scopeText,
      includeAlts ? "Hide Alts" : "Show Alts",
      disabled,
    );
  } else {
    addScopeBlock(container, scopeText);
  }

  const pageCases = options.historyPageCases ?? pages[0] ?? [];

  if (pageCases.length === 0) {
    // Only reachable when filtered to the viewed account and its own page is
    // empty while other linked accounts still hold the hidden cases stated
    // above — not the "screen has no entries at all" case, so the scope
    // block above stays and no full state-line replaces it.
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("**No cases on this account**"),
    );
    return;
  }

  const body = pageCases
    .map((c) => formatModerationCase(c, emojis, showTargetMention, true))
    .join("\n");

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
};
