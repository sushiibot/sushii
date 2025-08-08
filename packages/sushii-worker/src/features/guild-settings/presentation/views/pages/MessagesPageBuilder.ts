import type {
  ContainerBuilder} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import { SeparatorSpacingSize } from "discord.js";

import {
  createToggleButton,
  formatToggleMessageSetting,
} from "../components/SettingsComponents";
import type {
  SettingsMessageOptions} from "../components/SettingsConstants";
import {
  SETTINGS_CUSTOM_IDS
} from "../components/SettingsConstants";

export function addMessagesContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
): void {
  const { config, disabled = false } = options;

  // Header
  const headerText = new TextDisplayBuilder().setContent(
    "## Messages & Notifications Settings",
  );
  container.addTextDisplayComponents(headerText);

  // Join/Leave Messages Section Header
  let headerContent = "### Join/Leave Messages";
  headerContent += "\n";
  headerContent +=
    "Send custom messages when members join or leave the server.\n\n";

  // Current Channel Display
  if (config.messageSettings.messageChannel) {
    headerContent += `🗨️ **Channel:** <#${config.messageSettings.messageChannel}>`;
  } else {
    headerContent += "🗨️ **Channel:** No channel set";
  }

  headerContent += `\n> The channel join and leave messages will be sent to.`;

  const headerText2 = new TextDisplayBuilder().setContent(headerContent);
  container.addTextDisplayComponents(headerText2);

  // Channel Selection
  const channelRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(SETTINGS_CUSTOM_IDS.SET_JOIN_LEAVE_CHANNEL)
        .setPlaceholder("Set join/leave messages channel")
        .setDefaultChannels(
          config.messageSettings.messageChannel
            ? [config.messageSettings.messageChannel]
            : [],
        )
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setDisabled(disabled),
    );
  container.addActionRowComponents(channelRow);
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Join Message Section
  const joinMessageContent = formatToggleMessageSetting(
    "👋 Join Message",
    config.messageSettings.joinMessage,
    config.messageSettings.joinMessageEnabled,
    "Message sent when new members join",
  );
  const joinMessageText = new TextDisplayBuilder().setContent(
    joinMessageContent,
  );
  const joinMessageSection = new SectionBuilder()
    .addTextDisplayComponents(joinMessageText)
    .setButtonAccessory(
      createToggleButton(
        config.messageSettings.joinMessageEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLE_JOIN_MSG,
        disabled,
      ),
    );
  container.addSectionComponents(joinMessageSection);

  // Join Message Edit Button
  const joinEditRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_JOIN_MESSAGE)
      .setLabel("Edit Join Message")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
  container.addActionRowComponents(joinEditRow);
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Leave Message Section
  const leaveMessageContent = formatToggleMessageSetting(
    "🚪 Leave Message",
    config.messageSettings.leaveMessage,
    config.messageSettings.leaveMessageEnabled,
    "Message sent when members leave",
  );
  const leaveMessageText = new TextDisplayBuilder().setContent(
    leaveMessageContent,
  );
  const leaveMessageSection = new SectionBuilder()
    .addTextDisplayComponents(leaveMessageText)
    .setButtonAccessory(
      createToggleButton(
        config.messageSettings.leaveMessageEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLE_LEAVE_MSG,
        disabled,
      ),
    );
  container.addSectionComponents(leaveMessageSection);

  // Leave Message Edit Button
  const leaveEditRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_LEAVE_MESSAGE)
      .setLabel("Edit Leave Message")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
  container.addActionRowComponents(leaveEditRow);
}
