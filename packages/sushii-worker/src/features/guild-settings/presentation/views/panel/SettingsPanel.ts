import type { ButtonBuilder as ButtonBuilderType } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
} from "discord.js";

import Color from "@/utils/colors";

import type { SettingsTab } from "../../session/settingsIds";
import { SETTINGS_TABS, settingsIds } from "../../session/settingsIds";
import { addAutomodPanel } from "./AutomodPanel";
import { addLoggingPanel } from "./LoggingPanel";
import { addModerationPanel } from "./ModerationPanel";
import { addOverviewPanel } from "./OverviewPanel";
import { addWelcomePanel } from "./WelcomePanel";
import type { PanelEmojis } from "./panelParts";
import { divider, emojiOrEmpty, text } from "./panelParts";
import type { PanelInput } from "./panelTypes";

export { PANEL_EMOJI_NAMES } from "./panelParts";
export type { PanelEmojis } from "./panelParts";
export type { PanelInput } from "./panelTypes";
export type { MessagePreviewContext } from "./messagePreview";

const TAB_LABELS: Record<SettingsTab, string> = {
  overview: "Overview",
  logging: "Logging",
  moderation: "Moderation",
  automod: "Automod",
  welcome: "Welcome",
};

const TAB_EMOJIS: Record<SettingsTab, keyof PanelEmojis | null> = {
  overview: null,
  logging: "logs",
  moderation: "ban",
  automod: "shield",
  welcome: "member_join",
};

const FOOTER_TEXT =
  "-# Changes save automatically · expires after 5 minutes idle";
const EXPIRED_FOOTER_TEXT =
  "-# Expired after 5 minutes idle. Run `/settings` again to make changes.";

function tabRow(input: PanelInput): ActionRowBuilder<ButtonBuilderType> {
  const row = new ActionRowBuilder<ButtonBuilderType>();

  for (const tab of SETTINGS_TABS) {
    const active = tab === input.tab;
    const button = new ButtonBuilder()
      .setCustomId(settingsIds.tab(tab))
      .setLabel(TAB_LABELS[tab])
      .setStyle(
        active && !input.expired ? ButtonStyle.Primary : ButtonStyle.Secondary,
      )
      .setDisabled(input.expired || active);

    const category = TAB_EMOJIS[tab];
    const emojiName =
      category && input.status.tabAttention[tab] ? "warning" : category;
    const emoji = emojiName ? emojiOrEmpty(input.emojis, emojiName) : "";
    if (emoji) {
      button.setEmoji(emoji);
    }

    row.addComponents(button);
  }

  return row;
}

function addPage(container: ContainerBuilder, input: PanelInput): void {
  switch (input.tab) {
    case "overview":
      addOverviewPanel(container, input);
      break;
    case "logging":
      addLoggingPanel(container, input);
      break;
    case "moderation":
      addModerationPanel(container, input);
      break;
    case "automod":
      addAutomodPanel(container, input);
      break;
    case "welcome":
      addWelcomePanel(container, input);
      break;
  }
}

export function buildSettingsPanel(
  input: PanelInput,
  footerAccessory?: ButtonBuilderType,
): {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
} {
  const container = new ContainerBuilder().setAccentColor(
    input.status.tabAttention[input.tab] ? Color.Warning : Color.Info,
  );

  container.addActionRowComponents(tabRow(input));
  container.addSeparatorComponents(divider());

  addPage(container, input);

  container.addSeparatorComponents(divider());
  const footer = text(input.expired ? EXPIRED_FOOTER_TEXT : FOOTER_TEXT);
  if (footerAccessory) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(footer)
        .setButtonAccessory(footerAccessory),
    );
  } else {
    container.addTextDisplayComponents(footer);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
