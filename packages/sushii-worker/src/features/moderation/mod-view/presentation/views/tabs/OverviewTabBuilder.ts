import type { ContainerBuilder } from "discord.js";
import { TextDisplayBuilder } from "discord.js";

import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  formatActionTypeAsSentence,
  getActionTypeBotEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import { quoteMarkdownString } from "@/utils/markdown";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

import { MODVIEW_CUSTOM_IDS } from "../../customIds";
import type { ModViewTabContentBuilder } from "../ModViewMessageBuilder";
import { addScopeBlock, addSummaryRow } from "../components/ModViewChrome";

/**
 * Singular noun per type, in `ActionType`'s own declaration order — the
 * breakdown line must follow this order rather than any severity ranking
 * (the enum has none, and inventing one is explicitly out per the spec).
 */
const BREAKDOWN_NOUNS: ReadonlyArray<[ActionType, string]> = [
  [ActionType.Ban, "ban"],
  [ActionType.TempBan, "temp ban"],
  [ActionType.BanRemove, "unban"],
  [ActionType.Softban, "softban"],
  [ActionType.Kick, "kick"],
  [ActionType.Timeout, "timeout"],
  [ActionType.TimeoutRemove, "timeout removal"],
  [ActionType.TimeoutAdjust, "timeout adjustment"],
  [ActionType.Warn, "warn"],
  [ActionType.Note, "note"],
  [ActionType.History, "history"],
  [ActionType.Lookup, "lookup"],
];

function pluralize(noun: string, count: number): string {
  if (count === 1) {
    return noun;
  }

  if (noun.endsWith("y") && !/[aeiou]y$/.test(noun)) {
    return `${noun.slice(0, -1)}ies`;
  }

  return `${noun}s`;
}

function countWithNoun(count: number, noun: string): string {
  return `${count} ${pluralize(noun, count)}`;
}

/** `2 bans · 1 unban · 3 timeouts · 1 warn · 6 notes` — zero counts omitted. */
function formatBreakdown(
  cases: ReadonlyArray<{ actionType: ActionType }>,
): string | null {
  const counts = new Map<ActionType, number>();
  for (const c of cases) {
    counts.set(c.actionType, (counts.get(c.actionType) ?? 0) + 1);
  }

  const parts = BREAKDOWN_NOUNS.filter(
    ([type]) => (counts.get(type) ?? 0) > 0,
  ).map(([type, noun]) => countWithNoun(counts.get(type) ?? 0, noun));

  return parts.length > 0 ? parts.join(" · ") : null;
}

export const addOverviewTabContent: ModViewTabContentBuilder = (
  container: ContainerBuilder,
  options,
): void => {
  const { data, emojis } = options;
  const { history, identity, names, lookup, userInfo } = data;

  const historyCount = history.totalCases;
  const historyValue = history.linkedIdentity
    ? `${countWithNoun(historyCount, "case")} across ${history.linkedIdentity.members.length} accounts`
    : countWithNoun(historyCount, "case");
  addSummaryRow(
    container,
    "History",
    historyValue,
    MODVIEW_CUSTOM_IDS.openHistory,
    historyCount === 0,
  );

  const breakdown = formatBreakdown(history.moderationHistory);
  if (breakdown) {
    addScopeBlock(container, breakdown);
  }

  const altsCount = identity ? identity.members.length : 0;
  addSummaryRow(
    container,
    "Alts",
    countWithNoun(altsCount, "linked account"),
    MODVIEW_CUSTOM_IDS.openAlts,
    altsCount === 0,
  );

  const namesCount = names.history.length;
  addSummaryRow(
    container,
    "Names",
    names.eligibilityDenied
      ? "not available"
      : countWithNoun(namesCount, "change"),
    MODVIEW_CUSTOM_IDS.openNames,
    names.eligibilityDenied ? false : namesCount === 0,
  );

  const lookupCount = lookup ? lookup.crossServerBans.length : null;
  addSummaryRow(
    container,
    "Lookup",
    lookupCount === null
      ? "not available"
      : countWithNoun(lookupCount, "server ban"),
    MODVIEW_CUSTOM_IDS.openLookup,
    lookupCount === null ? false : lookupCount === 0,
  );

  // 4.10a: the exception to the entry-list empty-state rule — this statement
  // renders alongside the rows above, never in place of them, so it is built
  // inline here rather than via the shared state-line helper.
  if (historyCount === 0 && altsCount === 0 && namesCount === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "**Nothing recorded**\n-# No moderation records, linked accounts or name changes exist for this user in this guild.",
      ),
    );
  }

  const mostRecentCase = history.moderationHistory.at(-1);
  if (mostRecentCase) {
    addScopeBlock(container, "Most recent case");

    const emoji = emojis[getActionTypeBotEmoji(mostRecentCase.actionType)];
    const lines = [
      `\`#${mostRecentCase.caseId}\``,
      `${emoji} **${formatActionTypeAsSentence(mostRecentCase.actionType)}**`,
    ];

    if (mostRecentCase.userId !== userInfo.id) {
      lines.push(`on <@${mostRecentCase.userId}>`);
    }

    if (mostRecentCase.executorId) {
      lines.push(`by <@${mostRecentCase.executorId}>`);
    }

    lines.push(
      `<t:${timestampToUnixTime(mostRecentCase.actionTime.getTime())}:R>`,
    );

    let content = lines.join(" · ");
    if (mostRecentCase.reason) {
      content += `\n${quoteMarkdownString(mostRecentCase.reason.value)}`;
    }

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "-# Use a tab above to view full details.",
    ),
  );
};
