import {
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type {
  Member,
  MemberGroup,
} from "@/features/alt-accounts/presentation/views/AltIdentityView";
import { groupMembers } from "@/features/alt-accounts/presentation/views/AltIdentityView";
import {
  TAB_CONTENT_CHAR_BUDGET,
  packItems,
  packMentions,
} from "@/shared/presentation/packLines";
import { countWithNoun } from "@/shared/presentation/pluralize";
import { quoteMarkdownString } from "@/utils/markdown";
import timestampToUnixTime from "@/utils/timestampToUnixTime";

import { MODVIEW_CUSTOM_IDS } from "../../customIds";
import type { ModViewTabContentBuilder } from "../ModViewMessageBuilder";
import {
  FIELD_SEPARATOR,
  addOverflowLine,
  addStateLine,
  addSubtextBlock,
} from "../components/ModViewChrome";

interface RenderedEntry {
  text: string;
  shownAccounts: number;
}

/**
 * Renders one linked-by batch as a single entry line, capped to `budget`
 * (never split — a group is taken whole or its trailing mentions dropped).
 * `groupMembers` is reused only to collapse a bulk `/alts link` into one
 * batch; the line shape and the viewed-account `· viewing` marker here are
 * specific to this tab, not shared with `buildAltIdentityContainer`.
 */
function formatEntry(
  group: MemberGroup,
  viewedUserId: string,
  budget: number,
): RenderedEntry {
  const timestamp = `<t:${timestampToUnixTime(group.linkedAt.getTime())}:R>`;
  const reasonLine = group.reason
    ? `\n${quoteMarkdownString(group.reason)}`
    : "";

  const meta = `linked by <@${group.linkedBy}>${FIELD_SEPARATOR}${timestamp}`;
  const available = Math.max(
    0,
    budget - meta.length - reasonLine.length - FIELD_SEPARATOR.length - 1,
  );

  const { text: mentionsText, shownCount } = packMentions(
    group.members,
    (member) => formatMention(member, viewedUserId),
    available,
  );

  return {
    text: `${mentionsText}${FIELD_SEPARATOR}${meta}${reasonLine}`,
    shownAccounts: shownCount,
  };
}

function formatMention(member: Member, viewedUserId: string): string {
  if (member.userId === viewedUserId) {
    return `**<@${member.userId}>**${FIELD_SEPARATOR}viewing`;
  }

  return `<@${member.userId}>`;
}

/**
 * Alts tab body. Builds its own container rather than reusing
 * `buildAltIdentityContainer` — that container's button is claimed by the
 * globally-routed `AltNicknameButtonHandler` before this view's own
 * collector ever sees the click, which would replace the whole message with
 * a bare alt panel and destroy the chrome. This builder only borrows
 * `groupMembers` for batching identical linked-by/time/reason rows.
 */
export const addAltsTabContent: ModViewTabContentBuilder = (
  container,
  options,
) => {
  const { data, disabled } = options;
  const identity = data.identity;

  if (!identity) {
    addStateLine(
      container,
      "No linked accounts",
      "This account has no accounts linked to it in this guild.",
    );
    return;
  }

  const { identity: identityEntity, members } = identity;
  const viewedUserId = data.userInfo.id;

  addSubtextBlock(
    container,
    `${countWithNoun(members.length, "account")}${FIELD_SEPARATOR}linked oldest first`,
  );

  const nameSection = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        identityEntity.nickname
          ? `Identity: **${identityEntity.nickname}**`
          : "No identity name set",
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(MODVIEW_CUSTOM_IDS.altsNickname)
        .setLabel(identityEntity.nickname ? "Rename Identity" : "Name Identity")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    );
  container.addSectionComponents(nameSection);

  const groups = groupMembers(members);
  const renderedEntries = groups.map((group) =>
    formatEntry(group, viewedUserId, TAB_CONTENT_CHAR_BUDGET),
  );

  const { text, shown } = packItems(
    renderedEntries,
    (entry) => entry.text,
    TAB_CONTENT_CHAR_BUDGET,
  );

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

  // packItems' `dropped` is per-item (a batch), not per-account, so the
  // overflow count is derived from how many accounts actually rendered.
  const shownAccounts = renderedEntries
    .slice(0, shown)
    .reduce((total, entry) => total + entry.shownAccounts, 0);

  if (shownAccounts < members.length) {
    addOverflowLine(container, members.length - shownAccounts, "account");
  }
};
