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
): string {
  const linkedTimestamp = dayjs.utc(member.linkedAt).unix();
  let line = `<@${member.userId}> — linked by <@${member.linkedBy}> <t:${linkedTimestamp}:R>`;

  if (member.reason) {
    line += `\n${quoteMarkdownString(member.reason)}`;
  }

  return line;
}

/**
 * Builds the `/alts view` container: nickname, capped member list, and a
 * nickname edit button accessory.
 */
export function buildAltIdentityContainer(
  identity: AltIdentityWithMembers,
  isDisabled = false,
): ContainerBuilder {
  const { identity: identityEntity, members } = identity;

  const title = identityEntity.nickname
    ? `## ${identityEntity.nickname}`
    : "## Linked Identity";

  const memberLines = members
    .slice(0, MAX_RENDERED_MEMBERS)
    .map(formatMemberLine);

  if (members.length > MAX_RENDERED_MEMBERS) {
    memberLines.push(`*+${members.length - MAX_RENDERED_MEMBERS} more*`);
  }

  const headerText = new TextDisplayBuilder().setContent(
    `${title}\n${memberLines.join("\n")}`,
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
    .setAccentColor(Color.Success)
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
