import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import { formatPermissionWarning } from "../../utils/PermissionChecker";
import {
  addToggleSetting,
} from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

export function addAutomodContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false, emojis } = options;

  // Alerts Channel Section
  const alertsChannelId = config.moderationSettings.automodAlertsChannelId;
  const alertsPermStatus =
    alertsChannelId && options.channelPermissions?.[alertsChannelId];
  const alertsPermWarning = alertsPermStatus
    ? formatPermissionWarning(alertsPermStatus)
    : null;

  const alertsDescription = [
    `### ${emojis.bell} Alerts Channel`,
    "Receive notifications in a channel whenever automod takes action.",
    alertsPermWarning,
  ]
    .filter(Boolean)
    .join("\n");

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(alertsDescription),
  );

  const alertsChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.CHANNELS.SET_AUTOMOD_ALERTS)
    .setPlaceholder("Select alerts channel...")
    .setDefaultChannels(
      config.moderationSettings.automodAlertsChannelId
        ? [config.moderationSettings.automodAlertsChannelId]
        : [],
    )
    .setMaxValues(1)
    .setMinValues(0)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setDisabled(disabled);

  container.addActionRowComponents(
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      alertsChannelSelect,
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Spam Detection Toggle Section
  addToggleSetting(
    container,
    `${emojis.lightning} Spam Detection`,
    "Automatically times out users who spam identical messages across channels",
    config.moderationSettings.automodSpamEnabled,
    SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SPAM,
    disabled,
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  const modLogNote = config.loggingSettings.modLogChannel
    ? `-# Timeouts will be tracked in <#${config.loggingSettings.modLogChannel}>.`
    : "-# Timeouts will be tracked in your mod log channel if one is configured.";

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(modLogNote),
  );
}
