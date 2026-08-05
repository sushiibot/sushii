import type {
  ButtonBuilder as ButtonBuilderType,
  ContainerBuilder,
} from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import { SETTINGS_CUSTOM_IDS, type SettingsPage } from "./SettingsConstants";

export const TAB_DEFS: readonly {
  tab: SettingsPage;
  label: string;
  customId: string;
}[] = [
  {
    tab: "overview",
    label: "Overview",
    customId: SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_OVERVIEW,
  },
  {
    tab: "logging",
    label: "Logging",
    customId: SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_LOGGING,
  },
  {
    tab: "moderation",
    label: "Moderation",
    customId: SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_MODERATION,
  },
  {
    tab: "mod-dms",
    label: "Mod DMs",
    customId: SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_MOD_DMS,
  },
  {
    tab: "lookup",
    label: "Lookup",
    customId: SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_LOOKUP,
  },
  {
    tab: "messages",
    label: "Welcome",
    customId: SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_MESSAGES,
  },
  {
    tab: "automod",
    label: "Automod",
    customId: SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_AUTOMOD,
  },
  {
    tab: "more",
    label: "More",
    customId: SETTINGS_CUSTOM_IDS.NAVIGATION.TAB_MORE,
  },
];

/**
 * Two action rows (5 + 3) since Discord caps a single row at 5 buttons.
 * Active tab is `Primary`+disabled (can't click your own tab); expired,
 * every tab is `Secondary`+disabled instead — the two states must stay
 * visually distinct.
 */
export function addTabRows(
  container: ContainerBuilder,
  activeTab: SettingsPage,
  disabled: boolean,
): void {
  const rows = [TAB_DEFS.slice(0, 5), TAB_DEFS.slice(5)];

  for (const rowDefs of rows) {
    const row = new ActionRowBuilder<ButtonBuilderType>();

    for (const def of rowDefs) {
      const isActive = def.tab === activeTab;

      const button = new ButtonBuilder()
        .setCustomId(def.customId)
        .setLabel(def.label)
        .setStyle(
          isActive && !disabled ? ButtonStyle.Primary : ButtonStyle.Secondary,
        )
        .setDisabled(disabled || isActive);

      row.addComponents(button);
    }

    container.addActionRowComponents(row);
  }
}

/**
 * Maps both the tab-row customIds and Overview's "View ›" accessory
 * customIds to their target page — the latter need distinct ids from the
 * tab row since Discord rejects duplicate custom_ids on one message, but
 * both should dispatch through this single lookup.
 */
export const SETTINGS_TAB_BY_CUSTOM_ID: ReadonlyMap<string, SettingsPage> =
  new Map([
    ...TAB_DEFS.map((def) => [def.customId, def.tab] as const),
    [SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_LOGGING, "logging"],
    [SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MODERATION, "moderation"],
    [SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MOD_DMS, "mod-dms"],
    [SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_LOOKUP, "lookup"],
    [SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MESSAGES, "messages"],
    [SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_AUTOMOD, "automod"],
  ]);
