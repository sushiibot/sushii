import type { CacheType, ContainerBuilder, Interaction } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

import { formatPermissionWarning } from "../../utils/PermissionChecker";
import {
  createToggleSection,
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
    .replace(/<username>/g, interaction.user.username)
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
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Messages"),
  );

  // Join/Leave Messages Section Header
  let headerContent = "### Join/Leave Messages\n";
  headerContent +=
    "Send custom messages when members join or leave the server.\n\n";
  headerContent += "**Available placeholders:** `<mention>` · `<server>` · `<member_number>`";

  if (config.messageSettings.messageChannel) {
    headerContent += `\n\n**Channel:** <#${config.messageSettings.messageChannel}>`;

    if (options.channelPermissions?.[config.messageSettings.messageChannel]) {
      const warning = formatPermissionWarning(
        options.channelPermissions[config.messageSettings.messageChannel],
      );
      if (warning) {
        headerContent += `\n${warning}`;
      }
    }
  } else {
    headerContent += "\n\n**Channel:** No channel set";
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(headerContent),
  );

  // Channel Selection
  container.addActionRowComponents(
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
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Join Message Toggle Section
  const exampleJoinTemplate =
    "Welcome <mention> to <server>! You are member #<member_number>";
  const joinPreview = renderMessagePreview(
    config.messageSettings.joinMessage,
    interaction,
  );
  const exampleJoinPreview = renderMessagePreview(exampleJoinTemplate, interaction);

  let joinDescription = "Message sent when new members join";
  if (config.messageSettings.joinMessage && joinPreview) {
    joinDescription += `\n**Preview:** ${joinPreview}`;
  } else if (exampleJoinPreview) {
    joinDescription += `\n**Example:** ${exampleJoinPreview}`;
  } else {
    joinDescription += `\n**Example:** ${exampleJoinTemplate}`;
  }

  container.addSectionComponents(
    createToggleSection(
      "Join Message",
      joinDescription,
      config.messageSettings.joinMessageEnabled,
      SETTINGS_CUSTOM_IDS.TOGGLES.JOIN_MSG,
      disabled,
    ),
  );

  if (config.messageSettings.joinMessage) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${config.messageSettings.joinMessage.replace(/\n/g, "\n> ")}`,
      ),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_JOIN_MESSAGE)
        .setLabel("Edit Join Message")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    ),
  );

  container.addSeparatorComponents(
    new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Large),
  );

  // Leave Message Toggle Section
  const exampleLeaveTemplate = "<mention> has left <server>";
  const leavePreview = renderMessagePreview(
    config.messageSettings.leaveMessage,
    interaction,
  );
  const exampleLeavePreview = renderMessagePreview(exampleLeaveTemplate, interaction);

  let leaveDescription = "Message sent when members leave";
  if (config.messageSettings.leaveMessage && leavePreview) {
    leaveDescription += `\n**Preview:** ${leavePreview}`;
  } else if (exampleLeavePreview) {
    leaveDescription += `\n**Example:** ${exampleLeavePreview}`;
  } else {
    leaveDescription += `\n**Example:** ${exampleLeaveTemplate}`;
  }

  container.addSectionComponents(
    createToggleSection(
      "Leave Message",
      leaveDescription,
      config.messageSettings.leaveMessageEnabled,
      SETTINGS_CUSTOM_IDS.TOGGLES.LEAVE_MSG,
      disabled,
    ),
  );

  if (config.messageSettings.leaveMessage) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `> ${config.messageSettings.leaveMessage.replace(/\n/g, "\n> ")}`,
      ),
    );
  }

  container.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_LEAVE_MESSAGE)
        .setLabel("Edit Leave Message")
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled),
    ),
  );
}
