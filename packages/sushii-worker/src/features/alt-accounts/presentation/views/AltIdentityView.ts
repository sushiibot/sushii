import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import Color from "@/utils/colors";
import dayjs from "@/shared/domain/dayjs";
import { quoteMarkdownString } from "@/utils/markdown";

import type { AltIdentityWithMembers } from "../../domain/types/AltIdentityWithMembers";
import { buildNicknameButtonId } from "../customIds";

/** Discord rejects a Text Display above this many characters. */
const TEXT_DISPLAY_LIMIT = 4000;
/** Absorbs the joining newlines and the trailing "+N more" line. */
const BUDGET_SLACK = 64;

type Member = AltIdentityWithMembers["members"][number];

interface MemberGroup {
  linkedBy: string;
  linkedAt: Date;
  reason: string | null;
  members: Member[];
}

function formatMention(userId: string, highlighted: ReadonlySet<string>): string {
  return highlighted.has(userId) ? `**<@${userId}>**` : `<@${userId}>`;
}

/**
 * Collapses consecutive members sharing a linker, timestamp, and reason into
 * one group. A bulk link writes identical values for every new member, so it
 * always renders as a single group rather than N near-identical lines.
 */
function groupMembers(members: Member[]): MemberGroup[] {
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

interface RenderedGroup {
  text: string;
  shownMembers: number;
}

/**
 * Renders one group, dropping trailing mentions if the group alone would
 * exceed `budget`. Returns null when even the header doesn't fit.
 */
function formatGroup(
  group: MemberGroup,
  highlighted: ReadonlySet<string>,
  budget: number,
): RenderedGroup | null {
  const timestamp = `<t:${dayjs.utc(group.linkedAt).unix()}:R>`;
  const reasonLine = group.reason
    ? `\n${quoteMarkdownString(group.reason)}`
    : "";

  // A lone member reads better on one line than as a header plus a list.
  if (group.members.length === 1) {
    const mention = formatMention(group.members[0].userId, highlighted);
    const text = `${mention} — linked by <@${group.linkedBy}> ${timestamp}${reasonLine}`;

    return text.length <= budget ? { text, shownMembers: 1 } : null;
  }

  const header = `Linked by <@${group.linkedBy}> ${timestamp}\n`;
  const available = budget - header.length - reasonLine.length;

  const mentions: string[] = [];
  let used = 0;

  for (const member of group.members) {
    const mention = formatMention(member.userId, highlighted);
    const cost = mentions.length === 0 ? mention.length : mention.length + 2;

    if (used + cost > available) {
      break;
    }

    mentions.push(mention);
    used += cost;
  }

  if (mentions.length === 0) {
    return null;
  }

  // Members dropped here are covered by the trailing "+N more" line.
  return {
    text: `${header}${mentions.join(", ")}${reasonLine}`,
    shownMembers: mentions.length,
  };
}

/**
 * Renders groups in order until the character budget runs out. Groups holding
 * highlighted members are always rendered — otherwise the accounts a `/alts
 * link` just added could fall past the cut on a large identity.
 */
function renderGroups(
  groups: MemberGroup[],
  highlighted: ReadonlySet<string>,
  totalMembers: number,
  budget: number,
): string {
  const rendered = new Map<number, string>();
  let used = 0;
  let shownMembers = 0;

  const take = (index: number): void => {
    if (rendered.has(index)) {
      return;
    }

    const group = formatGroup(groups[index], highlighted, budget - used);
    if (!group) {
      return;
    }

    rendered.set(index, group.text);
    used += group.text.length + 1;
    shownMembers += group.shownMembers;
  };

  groups.forEach((group, index) => {
    if (group.members.some((member) => highlighted.has(member.userId))) {
      take(index);
    }
  });

  groups.forEach((_, index) => take(index));

  const lines = [...rendered.keys()].sort((a, b) => a - b).map((index) => rendered.get(index)!);

  if (shownMembers < totalMembers) {
    lines.push(`*+${totalMembers - shownMembers} more*`);
  }

  return lines.join("\n");
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
 * nickname, optional note, grouped member list, and a nickname edit button
 * accessory.
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
    ? `## ${identityEntity.nickname}`
    : "## Linked Identity";

  const historyFooter =
    members.length > 1
      ? "-# Run `/history` on any account above to see all of them combined."
      : null;

  // The member list gets whatever the surrounding text doesn't need, so a long
  // note or reason shrinks the list instead of overflowing the whole component.
  const memberBudget = Math.max(
    0,
    TEXT_DISPLAY_LIMIT -
      title.length -
      (note?.length ?? 0) -
      (historyFooter?.length ?? 0) -
      BUDGET_SLACK,
  );

  const memberText = renderGroups(
    groupMembers(members),
    new Set(highlightUserIds),
    members.length,
    memberBudget,
  );

  const content = [title, note, memberText, historyFooter]
    .filter(Boolean)
    .join("\n");

  const headerText = new TextDisplayBuilder().setContent(
    content.length > TEXT_DISPLAY_LIMIT
      ? content.slice(0, TEXT_DISPLAY_LIMIT - 1) + "…"
      : content,
  );

  const nicknameButton = new ButtonBuilder()
    .setCustomId(buildNicknameButtonId(identityEntity.id))
    .setLabel(identityEntity.nickname ? "Edit Nickname" : "Set Nickname")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(isDisabled);

  const headerSection = new SectionBuilder()
    .addTextDisplayComponents(headerText)
    .setButtonAccessory(nicknameButton);

  return new ContainerBuilder()
    .setAccentColor(color)
    .addSectionComponents(headerSection);
}

export function buildNoIdentityContainer(userId: string): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(Color.Warning)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `<@${userId}> has no linked accounts tracked in this server.`,
      ),
    );
}
