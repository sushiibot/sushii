import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import dayjs from "@/shared/domain/dayjs";
import {
  TAB_CONTENT_CHAR_BUDGET,
  packItems,
  packMentions,
} from "@/shared/presentation/packLines";
import { formatOverflowLine } from "@/shared/presentation/pluralize";
import Color from "@/utils/colors";
import { quoteMarkdownString } from "@/utils/markdown";

import type { AltIdentityWithMembers } from "../../domain/types/AltIdentityWithMembers";
import { buildNicknameButtonId } from "../customIds";

export type Member = AltIdentityWithMembers["members"][number];

export interface MemberGroup {
  linkedBy: string;
  linkedAt: Date;
  reason: string | null;
  members: Member[];
}

function formatMention(
  userId: string,
  highlighted: ReadonlySet<string>,
): string {
  return highlighted.has(userId) ? `**<@${userId}>**` : `<@${userId}>`;
}

/**
 * Collapses consecutive members sharing a linker, timestamp, and reason into
 * one group. A bulk link writes identical values for every new member, so it
 * always renders as a single group rather than N near-identical lines.
 */
export function groupMembers(members: Member[]): MemberGroup[] {
  const groups: MemberGroup[] = [];

  for (const member of members) {
    const last = groups.at(-1);
    const sameBatch =
      last !== undefined &&
      last.linkedBy === member.linkedBy &&
      last.reason === member.reason &&
      dayjs.utc(last.linkedAt).unix() === dayjs.utc(member.linkedAt).unix();

    if (sameBatch) {
      last.members.push(member);
    } else {
      groups.push({
        linkedBy: member.linkedBy,
        linkedAt: member.linkedAt,
        reason: member.reason,
        members: [member],
      });
    }
  }

  return groups;
}

/**
 * Renders one linked-by batch as a single body item; never split across the
 * cut. `budget` caps the whole rendered group, including its header and
 * reason line, so a batch large enough to blow past a Text Display's limit on
 * its own (a single `/alts link` can add hundreds of accounts at once) still
 * yields a group that fits — trailing mentions are dropped and folded into
 * the caller's overflow count instead.
 */
function formatGroup(
  group: MemberGroup,
  highlighted: ReadonlySet<string>,
  budget: number,
): { text: string; shownMembers: number } {
  const timestamp = `<t:${dayjs.utc(group.linkedAt).unix()}:R>`;
  const reasonLine = group.reason
    ? `\n${quoteMarkdownString(group.reason)}`
    : "";

  // A lone member reads better on one line than as a header plus a list.
  if (group.members.length === 1) {
    const mention = formatMention(group.members[0].userId, highlighted);
    return {
      text: `${mention} · linked by <@${group.linkedBy}> · ${timestamp}${reasonLine}`,
      shownMembers: 1,
    };
  }

  const header = `Linked by <@${group.linkedBy}> · ${timestamp}`;
  const available = Math.max(0, budget - header.length - reasonLine.length - 1);

  const { text: mentionsText, shownCount } = packMentions(
    group.members,
    (member) => formatMention(member.userId, highlighted),
    available,
  );

  return {
    text: `${header}\n${mentionsText}${reasonLine}`,
    shownMembers: shownCount,
  };
}

/**
 * Orders groups so ones holding highlighted members come first — otherwise the
 * accounts a `/alts link` just added could fall past the packing cut on a
 * large identity. A no-op when nothing is highlighted, which keeps `/alts
 * view` in chronological order.
 */
function prioritizeHighlighted(
  groups: MemberGroup[],
  highlighted: ReadonlySet<string>,
): MemberGroup[] {
  const isHighlighted = (group: MemberGroup): boolean =>
    group.members.some((member) => highlighted.has(member.userId));

  return [
    ...groups.filter(isHighlighted),
    ...groups.filter((group) => !isHighlighted(group)),
  ];
}

export interface AltIdentityContainerOptions {
  isDisabled?: boolean;
  /** Extra line(s) shown above the member list, e.g. what a `/alts link` call just did. */
  note?: string;
  color?: Color;
  /** Members bolded in the list, e.g. the accounts just added by `/alts link`. */
  highlightUserIds?: readonly string[];
}

/**
 * Builds the identity container shared by `/alts view` and `/alts link`:
 * identity name, optional note, grouped member list, and a name/rename
 * identity button accessory.
 */
export function buildAltIdentityContainer(
  identity: AltIdentityWithMembers,
  options: AltIdentityContainerOptions = {},
): ContainerBuilder {
  const {
    isDisabled = false,
    note,
    color = Color.Success,
    highlightUserIds = [],
  } = options;
  const { identity: identityEntity, members } = identity;

  const title = identityEntity.nickname
    ? `-# Identity: **${identityEntity.nickname}**`
    : "-# Identity: **Unnamed**";

  const historyFooter =
    members.length > 1
      ? "-# Run `/history` on any account above to see all of them combined."
      : null;

  const highlighted = new Set(highlightUserIds);

  // The member list gets whatever the surrounding text doesn't need, so a long
  // note or reason shrinks the list instead of overflowing the whole component.
  const memberBudget = Math.max(
    0,
    TAB_CONTENT_CHAR_BUDGET -
      title.length -
      (note?.length ?? 0) -
      (historyFooter?.length ?? 0),
  );

  const orderedGroups = prioritizeHighlighted(
    groupMembers(members),
    highlighted,
  );
  // Cap each group's own rendered size to memberBudget up front, so a single
  // oversized batch (packItems always keeps the first item) can never itself
  // exceed the Text Display limit — see formatGroup.
  const renderedGroups = orderedGroups.map((group) =>
    formatGroup(group, highlighted, memberBudget),
  );
  // `shown` counts dropped *batches*, but the overflow line below counts
  // dropped *accounts* — a different, correct number derived from
  // `shownMembers` instead.
  const { text: memberText, shown } = packItems(
    renderedGroups,
    (rendered) => rendered.text,
    memberBudget,
  );
  const shownMembers = renderedGroups
    .slice(0, shown)
    .reduce((total, rendered) => total + rendered.shownMembers, 0);
  const overflowCount = members.length - shownMembers;
  const overflowLine =
    overflowCount > 0 ? formatOverflowLine(overflowCount, "account") : null;

  const content = [title, note, memberText, overflowLine, historyFooter]
    .filter(Boolean)
    .join("\n");

  const headerText = new TextDisplayBuilder().setContent(content);

  const nicknameButton = new ButtonBuilder()
    .setCustomId(buildNicknameButtonId(identityEntity.id))
    .setLabel(identityEntity.nickname ? "Rename Identity" : "Name Identity")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(isDisabled);

  const headerSection = new SectionBuilder()
    .addTextDisplayComponents(headerText)
    .setButtonAccessory(nicknameButton);

  return new ContainerBuilder()
    .setAccentColor(color)
    .addSectionComponents(headerSection);
}
