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
  let description = config.baseDescription;

  // Add permission warning if needed
  if (config.channel && options.channelPermissions?.[config.channel]) {
    const warning = formatPermissionWarning(
      options.channelPermissions[config.channel],
    );
    if (warning) {
      description += `\n${warning}`;
    }
  }

  addToggleSetting(container, config.title, description, config.enabled, config.toggleCustomId, disabled);

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
  const saveEmoji = options.emojis?.save;
  const headerText = new TextDisplayBuilder().setContent(
    `## ${saveEmoji ? `${saveEmoji} ` : ""}Logging`,
  );
  container.addTextDisplayComponents(headerText);

  // Logging Section
  const loggingIntro = new TextDisplayBuilder().setContent(
    "### Logs\nTrack moderation, member, and message activity.",
  );
  container.addTextDisplayComponents(loggingIntro);

  const { emojis } = options;

  // Mod Logs Section
  createLogSection(
    container,
    {
      title: `${emojis?.history ? `${emojis.history} ` : ""}Mod Logs`,
      enabled: config.loggingSettings.modLogEnabled,
      channel: config.loggingSettings.modLogChannel,
      baseDescription:
        "Logs staff actions like bans, kicks, timeouts, and warnings",
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
      title: `${emojis?.user ? `${emojis.user} ` : ""}Member Logs`,
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
      title: `${emojis?.message_log ? `${emojis.message_log} ` : ""}Message Logs`,
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

  const msgLogText = new TextDisplayBuilder().setContent(
    "### Message Log Ignored Channels\nSelect busy channels to skip logging there and reduce spam.",
  );
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
        .setMaxValues(25)
        .setDefaultChannels(ignoredChannelIds.slice(0, 25))
        .setDisabled(disabled),
    );
  container.addActionRowComponents(msgLogChannelSelectRow);

  const count = ignoredChannelIds.length;
  const countText = new TextDisplayBuilder().setContent(
    count > 0 ? `-# ${count} channel${count === 1 ? "" : "s"}` : "-# None selected",
  );
  container.addTextDisplayComponents(countText);

  // Separator
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Reaction Logs Section
  createLogSection(
    container,
    {
      title: `${emojis?.bell ? `${emojis.bell} ` : ""}Reaction Logs`,
      enabled: config.loggingSettings.reactionLogEnabled,
      channel: config.loggingSettings.reactionLogChannel,
      baseDescription:
        "Logs reaction removals, including who added the reaction first." +
        " You can also right click a message > View Reaction Starters to view who initially added reactions",
      toggleCustomId: SETTINGS_CUSTOM_IDS.TOGGLES.REACTION_LOG,
      selectCustomId: SETTINGS_CUSTOM_IDS.CHANNELS.SET_REACTION_LOG,
      selectPlaceholder: "Set reaction log channel",
    },
    options,
    disabled,
  );
}
