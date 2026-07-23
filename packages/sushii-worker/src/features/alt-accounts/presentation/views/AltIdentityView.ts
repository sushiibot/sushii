import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { ActionRowBuilder } from "discord.js";

import type { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import {
  formatActionTypeAsSentence,
  getActionTypeEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";
import dayjs from "@/shared/domain/dayjs";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import Color from "@/utils/colors";
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

function formatMergedCase(moderationCase: ModerationCase): string {
  const emoji = getActionTypeEmoji(moderationCase.actionType);
  const actionName = formatActionTypeAsSentence(moderationCase.actionType);
  const timestamp = dayjs.utc(moderationCase.actionTime).unix();

  let s =
    `\`#${moderationCase.caseId}\` • ${emoji} **${actionName}** – <@${moderationCase.userId}>` +
    ` – <t:${timestamp}:R>`;

  if (moderationCase.executorId) {
    s += ` – <@${moderationCase.executorId}>`;
  }

  if (moderationCase.reason) {
    s += `\n${quoteMarkdownString(moderationCase.reason.value)}`;
  }

  return s;
}

/**
 * Builds the identity header block: nickname, capped member list, and a
 * nickname edit button accessory.
 */
function addIdentityHeader(
  container: ContainerBuilder,
  identity: AltIdentityWithMembers,
  isDisabled: boolean,
): void {
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

  container.addSectionComponents(headerSection);
  container.addSeparatorComponents(new SeparatorBuilder());
}

/**
 * Builds the combined `/alts view` container: identity header (with
 * nickname button) + one page of merged moderation history + pagination
 * nav.
 */
export function buildAltIdentityHistoryContainer(
  identity: AltIdentityWithMembers,
  cases: ModerationCase[],
  totalCases: number,
  navButtons: ActionRowBuilder<ButtonBuilder> | null,
  isDisabled: boolean,
): ContainerBuilder {
  const container = new ContainerBuilder().setAccentColor(Color.Success);

  addIdentityHeader(container, identity, isDisabled);

  const historyTitle = new TextDisplayBuilder().setContent(
    `### Moderation History (${totalCases} case${totalCases === 1 ? "" : "s"})`,
  );
  container.addTextDisplayComponents(historyTitle);

  if (cases.length === 0) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "No moderation history found for any linked account.",
      ),
    );
  } else {
    const casesText = new TextDisplayBuilder().setContent(
      cases.map(formatMergedCase).join("\n\n"),
    );
    container.addTextDisplayComponents(casesText);
  }

  ComponentsV2Paginator.addNavigationSection(container, navButtons, isDisabled);

  return container;
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
