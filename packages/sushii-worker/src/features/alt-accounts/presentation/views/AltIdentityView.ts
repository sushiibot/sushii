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

const MAX_RENDERED_MEMBERS = 20;

function formatMemberLine(
  member: AltIdentityWithMembers["members"][number],
  highlightUserId?: string,
): string {
  const linkedTimestamp = dayjs.utc(member.linkedAt).unix();
  const mention =
    member.userId === highlightUserId
      ? `**<@${member.userId}>**`
      : `<@${member.userId}>`;
  let line = `${mention} — linked by <@${member.linkedBy}> <t:${linkedTimestamp}:R>`;

  if (member.reason) {
    line += `\n${quoteMarkdownString(member.reason)}`;
  }

  return line;
}

export interface AltIdentityContainerOptions {
  isDisabled?: boolean;
  /** Extra line(s) shown above the member list, e.g. what a `/alts link` call just did. */
  note?: string;
  color?: Color;
  /** Marks one member's line, e.g. the account just added by `/alts link`. */
  highlightUserId?: string;
}

/**
 * Builds the identity container shared by `/alts view` and `/alts link`:
 * nickname, optional note, capped member list, and a nickname edit button
 * accessory.
 */
export function buildAltIdentityContainer(
  identity: AltIdentityWithMembers,
  options: AltIdentityContainerOptions = {},
): ContainerBuilder {
  const { isDisabled = false, note, color = Color.Success, highlightUserId } =
    options;
  const { identity: identityEntity, members } = identity;

  const title = identityEntity.nickname
    ? `## ${identityEntity.nickname}`
    : "## Linked Identity";

  const memberLines = members
    .slice(0, MAX_RENDERED_MEMBERS)
    .map((member) => formatMemberLine(member, highlightUserId));

  if (members.length > MAX_RENDERED_MEMBERS) {
    memberLines.push(`*+${members.length - MAX_RENDERED_MEMBERS} more*`);
  }

  const historyFooter =
    members.length > 1
      ? "-# Run `/history` on any account above to see all of them combined."
      : null;

  const headerText = new TextDisplayBuilder().setContent(
    [title, note, memberLines.join("\n"), historyFooter]
      .filter(Boolean)
      .join("\n"),
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
