import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";
import type { SettingsMessageOptions } from "../components/SettingsConstants";

export interface CategoryStatus {
  statusText: string;
  isConfigured: boolean;
}

export function computeLoggingStatus(config: GuildConfig): CategoryStatus {
  const {
    modLogChannel,
    memberLogChannel,
    messageLogChannel,
    reactionLogChannel,
  } = config.loggingSettings;
  const count = [
    modLogChannel,
    memberLogChannel,
    messageLogChannel,
    reactionLogChannel,
  ].filter((channel) => channel !== null).length;

  return {
    statusText: `${count}/4 log channels set`,
    isConfigured: count > 0,
  };
}

export function computeModerationStatus(config: GuildConfig): CategoryStatus {
  const {
    timeoutCommandDmEnabled,
    timeoutNativeDmEnabled,
    banDmEnabled,
    kickDmEnabled,
  } = config.moderationSettings;
  const count = [
    timeoutCommandDmEnabled,
    timeoutNativeDmEnabled,
    banDmEnabled,
    kickDmEnabled,
  ].filter(Boolean).length;

  // Descriptive only — defaults are mostly-on, so this never participates in
  // the "essentially unconfigured" heuristic below.
  return {
    statusText: `${count}/4 DM notifications on`,
    isConfigured: count > 0,
  };
}

export function computeModDmsStatus(config: GuildConfig): CategoryStatus {
  const { timeoutDmText, warnDmText, banDmText, kickDmText } =
    config.moderationSettings;
  // Boolean(), not `!== null` — legacy rows can hold "" rather than null for "no custom text".
  const count = [timeoutDmText, warnDmText, banDmText, kickDmText].filter(
    Boolean,
  ).length;

  return {
    statusText: `${count}/4 messages customized`,
    isConfigured: count > 0,
  };
}

export function computeLookupStatus(config: GuildConfig): CategoryStatus {
  const enabled = config.moderationSettings.lookupDetailsOptIn;

  return {
    statusText: enabled ? "Cross-server lookup on" : "Cross-server lookup off",
    isConfigured: enabled,
  };
}

export function computeMessagesStatus(config: GuildConfig): CategoryStatus {
  const { messageChannel, joinMessage, leaveMessage } = config.messageSettings;
  const channelSet = messageChannel !== null;

  return {
    statusText: channelSet ? "Welcome channel set" : "Welcome channel not set",
    isConfigured: channelSet || Boolean(joinMessage) || Boolean(leaveMessage),
  };
}

export function computeAutomodStatus(config: GuildConfig): CategoryStatus {
  const {
    automodAlertsChannelId,
    automodScamImageEnabled,
    automodSpamEnabled,
  } = config.moderationSettings;
  const channelSet = automodAlertsChannelId !== null;

  return {
    statusText: channelSet ? "Alerts channel set" : "Alerts channel not set",
    isConfigured: channelSet || automodScamImageEnabled || automodSpamEnabled,
  };
}

/**
 * Moderation is deliberately excluded — its 4 DM toggles default mostly-on
 * (timeout/ban true, kick false), so there's no clean "untouched" reading for
 * it. Everything else here has a clean null/false default, so this is a
 * reliable signal for "has this server done essentially nothing yet."
 */
export function isEssentiallyUnconfigured(config: GuildConfig): boolean {
  return (
    !computeLoggingStatus(config).isConfigured &&
    !computeAutomodStatus(config).isConfigured &&
    !computeModDmsStatus(config).isConfigured &&
    !computeMessagesStatus(config).isConfigured &&
    !computeLookupStatus(config).isConfigured
  );
}

function addCategoryRow(
  container: ContainerBuilder,
  name: string,
  description: string,
  status: CategoryStatus,
  viewCustomId: string,
  disabled: boolean,
): void {
  const section = new SectionBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${name}**\n${description}\n-# ${status.statusText}`,
      ),
    )
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(viewCustomId)
        .setLabel("View ›")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    );

  container.addSectionComponents(section);
}

export function addOverviewContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false, emojis } = options;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${emojis.save} Settings Overview`),
  );

  if (isEssentiallyUnconfigured(config)) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "👋 New server? We recommend starting with **Moderation**, **Logging**, and Automod's scam image detection.",
      ),
    );
  }

  addCategoryRow(
    container,
    "Logging",
    "Track moderation, member, and message activity in channels.",
    computeLoggingStatus(config),
    SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_LOGGING,
    disabled,
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  addCategoryRow(
    container,
    "Moderation",
    "Choose when the bot DMs users for timeouts, bans, and kicks.",
    computeModerationStatus(config),
    SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MODERATION,
    disabled,
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  addCategoryRow(
    container,
    "Moderation DMs",
    "Customize the text sent in moderation DMs.",
    computeModDmsStatus(config),
    SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MOD_DMS,
    disabled,
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  addCategoryRow(
    container,
    "Lookup",
    "Cross-server ban lookup — checks if a user is banned in other sushii servers.",
    computeLookupStatus(config),
    SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_LOOKUP,
    disabled,
  );
  container.addSeparatorComponents(new SeparatorBuilder());

  addCategoryRow(
    container,
    "Welcome Messages",
    "Greets new members in a channel when they join.",
    computeMessagesStatus(config),
    SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_MESSAGES,
    disabled,
  );

  addCategoryRow(
    container,
    "Automod",
    "Auto-flags known scam images and spam, alerts moderators for review.",
    computeAutomodStatus(config),
    SETTINGS_CUSTOM_IDS.OVERVIEW.VIEW_AUTOMOD,
    disabled,
  );
}
