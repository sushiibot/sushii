import type { ContainerBuilder } from "discord.js";
import { TextDisplayBuilder } from "discord.js";

import { formatModerationCase } from "@/features/moderation/cases/presentation/views/HistoryView";
import {
  countRecordedNameChanges,
  groupNameHistory,
} from "@/features/moderation/cases/presentation/views/UserNamesView";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { countWithNoun } from "@/shared/presentation/pluralize";

import { MODVIEW_CUSTOM_IDS } from "../../customIds";
import type { ModViewTabContentBuilder } from "../ModViewMessageBuilder";
import {
  FIELD_SEPARATOR,
  addSubtextBlock,
  addSummaryRow,
} from "../components/ModViewChrome";

/**
 * Singular noun per type, in `ActionType`'s own declaration order — the
 * breakdown line must follow this order rather than any severity ranking
 * (the enum has none, and inventing one is explicitly out per the spec).
 */
const BREAKDOWN_NOUNS: readonly [ActionType, string][] = [
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

/** `2 bans · 1 unban · 3 timeouts · 1 warn · 6 notes` — zero counts omitted. */
function formatBreakdown(
  cases: readonly { actionType: ActionType }[],
): string | null {
  const counts = new Map<ActionType, number>();
  for (const c of cases) {
    counts.set(c.actionType, (counts.get(c.actionType) ?? 0) + 1);
  }

  const parts = BREAKDOWN_NOUNS.filter(
    ([type]) => (counts.get(type) ?? 0) > 0,
  ).map(([type, noun]) => countWithNoun(counts.get(type) ?? 0, noun));

  return parts.length > 0 ? parts.join(FIELD_SEPARATOR) : null;
}

export const addOverviewTabContent: ModViewTabContentBuilder = (
  container: ContainerBuilder,
  options,
): void => {
  const { data, emojis, guildId } = options;
  const { history, identity, names, lookup, userInfo } = data;

  const historyCount = history.totalCases;
  const historyValue = history.linkedIdentity
    ? `${countWithNoun(historyCount, "case")} across ${countWithNoun(history.linkedIdentity.members.length, "account")}`
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
    addSubtextBlock(container, breakdown);
  }

  const altsCount = identity ? identity.members.length : 0;
  addSummaryRow(
    container,
    "Alts",
    countWithNoun(altsCount, "linked account"),
    MODVIEW_CUSTOM_IDS.openAlts,
    altsCount === 0,
  );

  // Recorded-only, scoped to this guild — the same definition the Names tab
  // itself states, never `names.history.length` raw: that field spans every
  // guild the bot shares with this user (see `NamesUserService.getNames`), so
  // counting it here would leak the user's nickname activity in other guilds
  // and disagree with what the Names tab actually shows.
  const namesCount = countRecordedNameChanges(groupNameHistory(names, guildId));
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

  // The exception to the entry-list empty-state rule — this statement
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
    addSubtextBlock(container, "Most recent case");

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        formatModerationCase(
          mostRecentCase,
          emojis,
          mostRecentCase.userId !== userInfo.id,
        ),
      ),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "-# Use a tab above to view full details.",
    ),
  );
};
