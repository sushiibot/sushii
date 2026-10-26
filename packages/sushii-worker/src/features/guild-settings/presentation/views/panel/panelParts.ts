import {
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import type {
  AttentionProblem,
  RowState,
} from "@/features/guild-settings/application/SettingsStatus";

import type {
  SettingsEditTarget,
  SettingsToggleTarget,
} from "../../session/settingsIds";
import { settingsIds } from "../../session/settingsIds";

export const PANEL_EMOJI_NAMES = [
  "enabled",
  "warning",
  "minus_silhouette",
  "logs",
  "ban",
  "shield",
  "member_join",
] as const satisfies readonly BotEmojiNameType[];

export type PanelEmojis = EmojiMap<typeof PANEL_EMOJI_NAMES>;

const UNICODE_STATUS = {
  on: "✅",
  off: "➖",
  attention: "⚠️",
} as const;

export function emojiOrEmpty(
  emojis: Partial<PanelEmojis>,
  name: keyof PanelEmojis,
): string {
  return emojis[name] ?? "";
}

export function statusIcon(
  emojis: Partial<PanelEmojis>,
  kind: RowState["kind"],
): string {
  switch (kind) {
    case "on":
      return emojiOrEmpty(emojis, "enabled") || UNICODE_STATUS.on;
    case "off":
      return emojiOrEmpty(emojis, "minus_silhouette") || UNICODE_STATUS.off;
    case "attention":
      return emojiOrEmpty(emojis, "warning") || UNICODE_STATUS.attention;
    case "not_set":
      return "";
  }
}

export function withIcon(icon: string, text: string): string {
  return icon ? `${icon} ${text}` : text;
}

export function channelMention(channelId: string): string {
  return `<#${channelId}>`;
}

export function attentionDetail(
  problem: AttentionProblem,
  channelId: string | null,
): string {
  switch (problem.kind) {
    case "missing_permissions":
      return `sushii can't post there: needs ${problem.permissions.join(", ")}`;
    case "missing_channel":
      return channelId
        ? `${channelMention(channelId)} was deleted, pick a new channel`
        : "Channel no longer exists, pick a new one";
    case "no_channel":
      return "On, but no channel picked";
    case "needs_mod_log":
      return "Right-click timeouts need the mod log turned on";
  }
}

export interface RowSpec {
  icon: string;
  name: string;
  value?: string;
  details?: (string | null | undefined)[];
  accessory: ButtonBuilder;
}

export function rowSection(spec: RowSpec): SectionBuilder {
  const head = withIcon(
    spec.icon,
    spec.value !== undefined
      ? `**${spec.name}** · ${spec.value}`
      : `**${spec.name}**`,
  );
  const lines = [head, ...(spec.details ?? []).filter((d) => !!d)];

  return new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    )
    .setButtonAccessory(spec.accessory);
}

export function smallText(text: string): string {
  return `-# ${text}`;
}

export function editButton(
  target: SettingsEditTarget,
  disabled: boolean,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(settingsIds.edit(target))
    .setLabel("Edit")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
}

export function toggleButton(
  target: SettingsToggleTarget,
  currentlyOn: boolean,
  disabled: boolean,
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(settingsIds.toggle(target))
    .setLabel(currentlyOn ? "Turn off" : "Turn on")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
}

export function divider(): SeparatorBuilder {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

export function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

export function isOnLike(state: RowState): boolean {
  return state.kind === "on" || state.kind === "attention";
}
