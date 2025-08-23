import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
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

import { formatPermissionWarning } from "../../utils/PermissionChecker";
import {
  createToggleButton,
  formatToggleMessageSetting,
} from "../components/SettingsComponents";
import type { SettingsMessageOptions } from "../components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../components/SettingsConstants";

function renderMessagePreview(
  template: string | null,
  interaction?: Interaction<CacheType>,
): string | null {
  if (!template || !interaction || !interaction.guild) {
    return null;
  }

  return template
    .replace(/<mention>/g, `<@${interaction.user.id}>`)
    .replace(/<username>/g, interaction.user.username) // Keep for backward compat
    .replace(/<server>/g, interaction.guild.name)
    .replace(/<member_number>/g, interaction.guild.memberCount.toString());
}

export function addMessagesContent(
  container: ContainerBuilder,
  options: SettingsMessageOptions,
  interaction?: Interaction<CacheType>,
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
    "Send custom messages when members join or leave the server.\n";
  headerContent += "\n📄 **Available placeholders:**\n";
  headerContent += "- `<mention>` - Mentions the user (@username)\n";
  headerContent += "- `<server>` - Your server's name\n";
  headerContent += "- `<member_number>` - What number member they are\n\n";

  // Current Channel Display
  if (config.messageSettings.messageChannel) {
    headerContent += `🗨️ **Channel:** <#${config.messageSettings.messageChannel}>`;

    // Add permission warning if needed
    if (options.channelPermissions?.[config.messageSettings.messageChannel]) {
      const warning = formatPermissionWarning(
        options.channelPermissions[config.messageSettings.messageChannel],
      );
      if (warning) {
        headerContent += `\n${warning}`;
      }
    }
  } else {
    headerContent += "🗨️ **Channel:** No channel set";
  }

  headerContent += `\n> 💡 Choose a public channel where you want welcome/goodbye messages to appear.`;

  const headerText2 = new TextDisplayBuilder().setContent(headerContent);
  container.addTextDisplayComponents(headerText2);

  // Channel Selection
  const channelRow =
    new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(SETTINGS_CUSTOM_IDS.CHANNELS.SET_JOIN_LEAVE)
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
  const joinPreview = renderMessagePreview(
    config.messageSettings.joinMessage,
    interaction,
  );
  const exampleJoinTemplate =
    "Welcome <mention> to <server>! You are member #<member_number>";
  const exampleJoinPreview = renderMessagePreview(
    exampleJoinTemplate,
    interaction,
  );

  let joinDescription = "Message sent when new members join";
  if (config.messageSettings.joinMessage && joinPreview) {
    // User has custom message - show only their preview
    joinDescription += `\n**Your Message Preview:**\n${joinPreview}`;
  } else {
    // No custom message - show example template and its preview
    joinDescription += `\n**Example:**\n${exampleJoinTemplate}`;
    if (exampleJoinPreview) {
      joinDescription += `\n**Example Preview:**\n${exampleJoinPreview}`;
    }
  }

  const joinMessageContent = formatToggleMessageSetting(
    "👋 Join Message",
    config.messageSettings.joinMessage,
    config.messageSettings.joinMessageEnabled,
    joinDescription,
  );
  const joinMessageText = new TextDisplayBuilder().setContent(
    joinMessageContent,
  );
  const joinMessageSection = new SectionBuilder()
    .addTextDisplayComponents(joinMessageText)
    .setButtonAccessory(
      createToggleButton(
        config.messageSettings.joinMessageEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLES.JOIN_MSG,
        disabled,
      ),
    );
  container.addSectionComponents(joinMessageSection);

  // Join Message Edit Button
  const joinEditRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_JOIN_MESSAGE)
      .setLabel("Edit Join Message")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
  container.addActionRowComponents(joinEditRow);
  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Leave Message Section
  const leavePreview = renderMessagePreview(
    config.messageSettings.leaveMessage,
    interaction,
  );
  const exampleLeaveTemplate = "<mention> has left <server>";
  const exampleLeavePreview = renderMessagePreview(
    exampleLeaveTemplate,
    interaction,
  );

  let leaveDescription = "Message sent when members leave";
  if (config.messageSettings.leaveMessage && leavePreview) {
    // User has custom message - show only their preview
    leaveDescription += `\n**Your Message Preview:**\n${leavePreview}`;
  } else {
    // No custom message - show example template and its preview
    leaveDescription += `\n**Example:**\n${exampleLeaveTemplate}`;
    if (exampleLeavePreview) {
      leaveDescription += `\n**Example Preview:**\n${exampleLeavePreview}`;
    }
  }

  const leaveMessageContent = formatToggleMessageSetting(
    "🚪 Leave Message",
    config.messageSettings.leaveMessage,
    config.messageSettings.leaveMessageEnabled,
    leaveDescription,
  );
  const leaveMessageText = new TextDisplayBuilder().setContent(
    leaveMessageContent,
  );
  const leaveMessageSection = new SectionBuilder()
    .addTextDisplayComponents(leaveMessageText)
    .setButtonAccessory(
      createToggleButton(
        config.messageSettings.leaveMessageEnabled,
        SETTINGS_CUSTOM_IDS.TOGGLES.LEAVE_MSG,
        disabled,
      ),
    );
  container.addSectionComponents(leaveMessageSection);

  // Leave Message Edit Button
  const leaveEditRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_LEAVE_MESSAGE)
      .setLabel("Edit Leave Message")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );

  container.addActionRowComponents(leaveEditRow);
}
