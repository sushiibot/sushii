import { TextDisplayBuilder } from "discord.js";

import {
  buildNameGroupLines,
  countRecordedNameChanges,
  formatNameValue,
  formatUsernameValue,
  groupNameHistory,
} from "@/features/moderation/cases/presentation/views/UserNamesView";
import { packItems } from "@/shared/presentation/packLines";
import { countWithNoun } from "@/shared/presentation/pluralize";

import type { ModViewTabContentBuilder } from "../ModViewMessageBuilder";
import {
  addOverflowLine,
  addStateLine,
  addSubtextBlock,
} from "../components/ModViewChrome";

const NAME_CHANGE_NOUN = "name change";

interface FlatRow {
  text: string;
  groupIndex: number;
}

/**
 * Names tab — bounded (packItems), never paginated. Reuses the group/label
 * formatters exported from `UserNamesView.ts` (`groupNameHistory`,
 * `buildNameGroupLines`) so the standalone `/names` reply and this tab render
 * name-change groups identically.
 */
export const addNamesTabContent: ModViewTabContentBuilder = (
  container,
  options,
) => {
  const { names } = options.data;

  if (names.eligibilityDenied) {
    addStateLine(
      container,
      "Name history unavailable",
      "Name history is shown only for current members or users with records in this guild.",
    );
    return;
  }

  const nameHistoryGroups = groupNameHistory(names, options.guildId);
  const { usernameEntries, globalNameEntries, nicknameEntries } =
    nameHistoryGroups;

  const groups = [
    buildNameGroupLines(
      "Username",
      usernameEntries,
      formatUsernameValue,
      options.user.username,
    ),
    buildNameGroupLines(
      "Display Name",
      globalNameEntries,
      formatNameValue,
      options.user.globalName,
    ),
    buildNameGroupLines(
      "Nickname (this server)",
      nicknameEntries,
      formatNameValue,
      options.member?.nickname,
    ),
  ];

  const total = groups.reduce((sum, g) => sum + g.entryLines.length, 0);
  const hasRecordedRow = groups.some((g) => g.hasRecordedRow);

  // `total` also counts synthesized "unobserved live value" rows below (see
  // `buildRows`) — the scope count states only changes actually observed, so
  // it can disagree with `total` and doesn't drive the packing budget above.
  const recordedCount = countRecordedNameChanges(nameHistoryGroups);
  addSubtextBlock(container, countWithNoun(recordedCount, NAME_CHANGE_NOUN));

  const flat: FlatRow[] = [];
  groups.forEach((group, groupIndex) => {
    for (const text of group.entryLines) {
      flat.push({ text, groupIndex });
    }
  });

  const packed = packItems(flat, (row) => row.text);
  const shownPrefix = flat.slice(0, packed.shown);

  const blocks: string[] = [];
  groups.forEach((group, groupIndex) => {
    if (group.entryLines.length === 0) {
      return;
    }

    // Label always states the group's true total, even if truncation left
    // some (or all) of its entries out of the shown prefix below.
    const shownRows = shownPrefix
      .filter((row) => row.groupIndex === groupIndex)
      .map((row) => row.text);

    blocks.push([group.labelLine, ...shownRows].join("\n"));
  });

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(blocks.join("\n")),
  );

  if (packed.shown < total) {
    addOverflowLine(container, total - packed.shown, NAME_CHANGE_NOUN);
  }

  // Every group's rows are synthesized live values (no history actually
  // observed) — the groups above still show what we know, but flag that
  // nothing was recorded rather than let the synthesized rows read as history.
  if (!hasRecordedRow) {
    addSubtextBlock(
      container,
      "Name history accumulates from changes observed after tracking began.",
    );
  }
};
