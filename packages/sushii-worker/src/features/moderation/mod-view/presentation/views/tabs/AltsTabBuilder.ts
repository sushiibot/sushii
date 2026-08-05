import {
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type { Member } from "@/features/alt-accounts/presentation/views/AltIdentityView";
import {
  TAB_CONTENT_CHAR_BUDGET,
  packMentions,
} from "@/shared/presentation/packLines";
import { countWithNoun } from "@/shared/presentation/pluralize";

import { MODVIEW_CUSTOM_IDS } from "../../customIds";
import type { ModViewTabContentBuilder } from "../ModViewMessageBuilder";
import {
  FIELD_SEPARATOR,
  addOverflowLine,
  addStateLine,
  addSubtextBlock,
} from "../components/ModViewChrome";

/**
 * Plain, flat mention list — who's linked, full stop. Linker/timestamp/reason
 * belong to the full alt-identity history (`buildAltIdentityContainer`), not
 * this at-a-glance overview: repeating them per account was noisy, and the
 * grouping they required (same linker, same second) just as often split
 * accounts linked moments apart onto separate lines.
 */
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
 * a bare alt panel and destroy the chrome.
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
      "This account has no accounts linked to it in this guild. Use `/alts link` to link one.",
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

  const { text, shownCount } = packMentions(
    members,
    (member) => formatMention(member, viewedUserId),
    TAB_CONTENT_CHAR_BUDGET,
  );

  if (text.length === 0) {
    // `members.length > 0` here — `ModViewService` includes single-member
    // identities and never returns a zero-member one — so `packMentions`
    // always keeps at least the first mention. This guard is a safety net
    // against `setContent("")` throwing if that invariant ever breaks,
    // matching `LookupTabBuilder`'s guard.
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("**No linked accounts**"),
    );
    return;
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));

  if (shownCount < members.length) {
    addOverflowLine(container, members.length - shownCount, "account");
  }

  addSubtextBlock(container, "Use `/alts link` to link another account.");
};
