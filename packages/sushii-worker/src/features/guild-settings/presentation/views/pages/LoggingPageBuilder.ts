import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  ActionRowBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import { formatPermissionWarning } from "../../utils/PermissionChecker";
import {
  createToggleButton,
  formatToggleSetting,
} from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

interface LogSectionConfig {
  title: string;
  enabled: boolean;
  channel: string | null;
  baseDescription: string;
  toggleCustomId: string;
  selectCustomId: string;
  selectPlaceholder: string;
}

function createLogSection(
  container: ContainerBuilder,
  config: LogSectionConfig,
  options: SettingsMessageOptions,
  disabled = false,
): void {
  let description = `${config.baseDescription}\n${
    config.channel
      ? `**Channel:** <#${config.channel}>`
      : "**Channel:** No channel set"
  }`;

  // Add permission warning if needed
  if (config.channel && options.channelPermissions?.[config.channel]) {
    const warning = formatPermissionWarning(
      options.channelPermissions[config.channel],
    );
    if (warning) {
      description += `\n${warning}`;
    }
  }

  const content = formatToggleSetting(config.title, config.enabled, description);
  const text = new TextDisplayBuilder().setContent(content);
  const section = new SectionBuilder()
    .addTextDisplayComponents(text)
    .setButtonAccessory(
      createToggleButton(config.enabled, config.toggleCustomId, disabled),
    );
  container.addSectionComponents(section);

  // Channel Selection
  const channelSelectRow = new ActionRowBuilder<ChannelSelectMenuBuilder>();
  const channelSelect = new ChannelSelectMenuBuilder()
    .setCustomId(config.selectCustomId)
    .setPlaceholder(config.selectPlaceholder)
    .setDefaultChannels(config.channel ? [config.channel] : [])
    .setMaxValues(1)
    .setMinValues(0)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setDisabled(disabled);
  channelSelectRow.addComponents(channelSelect);
  container.addActionRowComponents(channelSelectRow);
}

export function addLoggingContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  _interaction?: Interaction<CacheType>,
): void {
  const { config, disabled = false } = options;

  // Header
  const headerText = new TextDisplayBuilder().setContent("## Logging Settings");
  container.addTextDisplayComponents(headerText);

  // Logging Section
  const loggingIntro = new TextDisplayBuilder().setContent(
    "### Logs\nTrack moderation, member, and message activity.",
  );
  container.addTextDisplayComponents(loggingIntro);

  // Mod Logs Section
  createLogSection(
    container,
    {
      title: "🛡️ Mod Logs",
      enabled: config.loggingSettings.modLogEnabled,
      channel: config.loggingSettings.modLogChannel,
      baseDescription: "Logs staff actions like bans, kicks, timeouts, and warnings",
      toggleCustomId: SETTINGS_CUSTOM_IDS.TOGGLES.MOD_LOG,
      selectCustomId: SETTINGS_CUSTOM_IDS.CHANNELS.SET_MOD_LOG,
      selectPlaceholder: "Set mod log channel",
    },
    options,
    disabled,
  );

  // Divider
  container.addSeparatorComponents(new SeparatorBuilder());

  // Member Logs Section
  createLogSection(
    container,
    {
      title: "👥 Member Logs",
      enabled: config.loggingSettings.memberLogEnabled,
      channel: config.loggingSettings.memberLogChannel,
      baseDescription: "Logs member joins and leaves",
      toggleCustomId: SETTINGS_CUSTOM_IDS.TOGGLES.MEMBER_LOG,
      selectCustomId: SETTINGS_CUSTOM_IDS.CHANNELS.SET_MEMBER_LOG,
      selectPlaceholder: "Set member log channel",
    },
    options,
    disabled,
  );

  // Divider
  container.addSeparatorComponents(new SeparatorBuilder());

  // Message Logs Section
  createLogSection(
    container,
    {
      title: "📝 Message Logs",
      enabled: config.loggingSettings.messageLogEnabled,
      channel: config.loggingSettings.messageLogChannel,
      baseDescription: "Logs message edits and deletions",
      toggleCustomId: SETTINGS_CUSTOM_IDS.TOGGLES.MESSAGE_LOG,
      selectCustomId: SETTINGS_CUSTOM_IDS.CHANNELS.SET_MESSAGE_LOG,
      selectPlaceholder: "Set message log channel",
    },
    options,
    disabled,
  );

  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  let msgLogContent = "### Message Log Ignored Channels\n";
  msgLogContent +=
    "Select busy channels to skip logging there and reduce spam.\n";

  if (options.messageLogBlocks && options.messageLogBlocks.length > 0) {
    msgLogContent +=
      "The following channels are currently ignored for message logs:\n";
    msgLogContent += "> ";

    msgLogContent += options.messageLogBlocks
      .map((block) => `<#${block.channelId}>`)
      .join(", ");
  } else {
    msgLogContent += "No channels are currently ignored for message logs.";
  }

  const msgLogText = new TextDisplayBuilder().setContent(msgLogContent);
  container.addTextDisplayComponents(msgLogText);

  // Multi-select channel menu for managing ignored channels
  const ignoredChannelIds =
    options.messageLogBlocks?.map((block) => block.channelId) || [];

  const msgLogChannelSelectRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(SETTINGS_CUSTOM_IDS.CHANNELS.MESSAGE_LOG_IGNORE)
        .setPlaceholder("Add channels to ignore")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(25) // Discord's limit
        .setDefaultChannels(ignoredChannelIds.slice(0, 25))
        .setDisabled(disabled),
    );
  container.addActionRowComponents(msgLogChannelSelectRow);

  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Reaction Logs Section
  createLogSection(
    container,
    {
      title: "⭐ Reaction Logs",
      enabled: config.loggingSettings.reactionLogEnabled,
      channel: config.loggingSettings.reactionLogChannel,
      baseDescription: "Logs reaction additions and removals",
      toggleCustomId: SETTINGS_CUSTOM_IDS.TOGGLES.REACTION_LOG,
      selectCustomId: SETTINGS_CUSTOM_IDS.CHANNELS.SET_REACTION_LOG,
      selectPlaceholder: "Set reaction log channel",
    },
    options,
    disabled,
  );
}
