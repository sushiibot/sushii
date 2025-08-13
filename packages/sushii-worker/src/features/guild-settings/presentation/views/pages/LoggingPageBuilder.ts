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
  let modLogDescription = `Logs staff actions like bans, kicks, timeouts, and warnings\n${
    config.loggingSettings.modLogChannel
      ? `**Channel:** <#${config.loggingSettings.modLogChannel}>`
      : "**Channel:** No channel set"
  }`;

  // Add permission warning if needed
  if (
    config.loggingSettings.modLogChannel &&
    options.channelPermissions?.[config.loggingSettings.modLogChannel]
  ) {
    const warning = formatPermissionWarning(
      options.channelPermissions[config.loggingSettings.modLogChannel],
    );
    if (warning) {
      modLogDescription += `\n${warning}`;
    }
  }

  const modLogContent = formatToggleSetting(
    "🛡️ Mod Logs",
    config.loggingSettings.modLogEnabled,
    modLogDescription,
  );
  const modLogText = new TextDisplayBuilder().setContent(modLogContent);
  const modLogSection = new SectionBuilder()
    .addTextDisplayComponents(modLogText)
    .setButtonAccessory(
      createToggleButton(
        config.loggingSettings.modLogEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLE_MOD_LOG,
        disabled,
      ),
    );
  container.addSectionComponents(modLogSection);

  // Mod Log Channel Selection
  const modLogChannelSelectRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>();
  const modLogSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.SET_MOD_LOG_CHANNEL)
    .setPlaceholder("Set mod log channel")
    .setDefaultChannels(
      config.loggingSettings.modLogChannel
        ? [config.loggingSettings.modLogChannel]
        : [],
    )
    .setMaxValues(1)
    .setMinValues(0)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setDisabled(disabled);
  modLogChannelSelectRow.addComponents(modLogSelect);
  container.addActionRowComponents(modLogChannelSelectRow);

  // Divider
  container.addSeparatorComponents(new SeparatorBuilder());

  // Member Logs Section
  let memberLogDescription = `Logs member joins and leaves\n${
    config.loggingSettings.memberLogChannel
      ? `**Channel:** <#${config.loggingSettings.memberLogChannel}>`
      : "**Channel:** No channel set"
  }`;

  // Add permission warning if needed
  if (
    config.loggingSettings.memberLogChannel &&
    options.channelPermissions?.[config.loggingSettings.memberLogChannel]
  ) {
    const warning = formatPermissionWarning(
      options.channelPermissions[config.loggingSettings.memberLogChannel],
    );
    if (warning) {
      memberLogDescription += `\n${warning}`;
    }
  }

  const memberLogContent = formatToggleSetting(
    "👥 Member Logs",
    config.loggingSettings.memberLogEnabled,
    memberLogDescription,
  );
  const memberLogText = new TextDisplayBuilder().setContent(memberLogContent);
  const memberLogSection = new SectionBuilder()
    .addTextDisplayComponents(memberLogText)
    .setButtonAccessory(
      createToggleButton(
        config.loggingSettings.memberLogEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLE_MEMBER_LOG,
        disabled,
      ),
    );
  container.addSectionComponents(memberLogSection);

  // Member Log Channel Selection
  const memberLogChannelSelectRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>();
  const memberLogSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.SET_MEMBER_LOG_CHANNEL)
    .setPlaceholder("Set member log channel")
    .setDefaultChannels(
      config.loggingSettings.memberLogChannel
        ? [config.loggingSettings.memberLogChannel]
        : [],
    )
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setDisabled(disabled);
  memberLogChannelSelectRow.addComponents(memberLogSelect);
  container.addActionRowComponents(memberLogChannelSelectRow);

  // Divider
  container.addSeparatorComponents(new SeparatorBuilder());

  // Message Logs Section
  let messageLogDescription = `Logs message edits and deletions\n${
    config.loggingSettings.messageLogChannel
      ? `**Channel:** <#${config.loggingSettings.messageLogChannel}>`
      : "**Channel:** No channel set"
  }`;

  // Add permission warning if needed
  if (
    config.loggingSettings.messageLogChannel &&
    options.channelPermissions?.[config.loggingSettings.messageLogChannel]
  ) {
    const warning = formatPermissionWarning(
      options.channelPermissions[config.loggingSettings.messageLogChannel],
    );
    if (warning) {
      messageLogDescription += `\n${warning}`;
    }
  }

  const messageLogContent = formatToggleSetting(
    "📝 Message Logs",
    config.loggingSettings.messageLogEnabled,
    messageLogDescription,
  );
  const messageLogText = new TextDisplayBuilder().setContent(messageLogContent);
  const messageLogSection = new SectionBuilder()
    .addTextDisplayComponents(messageLogText)
    .setButtonAccessory(
      createToggleButton(
        config.loggingSettings.messageLogEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLE_MESSAGE_LOG,
        disabled,
      ),
    );
  container.addSectionComponents(messageLogSection);

  // Message Log Channel Selection
  const messageLogChannelSelectRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>();
  const messageLogSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.SET_MESSAGE_LOG_CHANNEL)
    .setPlaceholder("Set message log channel")
    .setDefaultChannels(
      config.loggingSettings.messageLogChannel
        ? [config.loggingSettings.messageLogChannel]
        : [],
    )
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setDisabled(disabled);
  messageLogChannelSelectRow.addComponents(messageLogSelect);
  container.addActionRowComponents(messageLogChannelSelectRow);

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
        .setCustomId(SETTINGS_CUSTOM_IDS.MESSAGE_LOG_IGNORE_CHANNELS)
        .setPlaceholder("Add channels to ignore")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(25) // Discord's limit
        .setDefaultChannels(ignoredChannelIds)
        .setDisabled(disabled),
    );
  container.addActionRowComponents(msgLogChannelSelectRow);
}
