import { sleep } from "bun";
import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
} from "discord.js";
import {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { ModalMessageModalSubmitInteraction } from "discord.js";
import type { Logger } from "pino";

import type { ToggleableSetting } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import { SlashCommandHandler } from "@/shared/presentation/handlers";

import type { GuildSettingsService } from "../../application/GuildSettingsService";
import type { MessageLogBlockService } from "../../application/MessageLogBlockService";
import {
  type ChannelPermissionsMap,
  checkMultipleChannelsPermissions,
} from "../utils/PermissionChecker";
import {
  createSettingsMessage,
  formatButtonRejectionResponse,
} from "../views/SettingsMessageBuilder";
import {
  createBanDmTextModal,
  createJoinMessageModal,
  createLeaveMessageModal,
  createTimeoutDmTextModal,
  createWarnDmTextModal,
} from "../views/components/SettingsComponents";
import type { SettingsPage } from "../views/components/SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "../views/components/SettingsConstants";

export default class SettingsCommand extends SlashCommandHandler {
  constructor(
    private readonly guildSettingsService: GuildSettingsService,
    private readonly messageLogBlockService: MessageLogBlockService,
    private readonly logger: Logger,
  ) {
    super();
  }

  command = new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Configure sushii server settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .toJSON();

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inCachedGuild()) {
      throw new Error("Guild not cached.");
    }

    return this.showSettingsPanel(interaction);
  }

  private getChannelPermissions(
    interaction:
      | ChatInputCommandInteraction<"cached">
      | MessageComponentInteraction<"cached">
      | ModalMessageModalSubmitInteraction<"cached">,
    config: GuildConfig,
  ): ChannelPermissionsMap {
    const channelIds: string[] = [];

    // Collect all log channel IDs that are configured
    if (config.loggingSettings.modLogChannel) {
      channelIds.push(config.loggingSettings.modLogChannel);
    }
    if (config.loggingSettings.memberLogChannel) {
      channelIds.push(config.loggingSettings.memberLogChannel);
    }
    if (config.loggingSettings.messageLogChannel) {
      channelIds.push(config.loggingSettings.messageLogChannel);
    }
    if (config.loggingSettings.reactionLogChannel) {
      channelIds.push(config.loggingSettings.reactionLogChannel);
    }
    if (config.messageSettings.messageChannel) {
      channelIds.push(config.messageSettings.messageChannel);
    }

    // Remove duplicates and check permissions
    const uniqueChannelIds = [...new Set(channelIds)];
    return checkMultipleChannelsPermissions(
      interaction.guild,
      uniqueChannelIds,
    );
  }

  private async showSettingsPanel(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const config = await this.guildSettingsService.getGuildSettings(
      interaction.guildId,
    );
    const messageLogBlocks =
      await this.messageLogBlockService.getIgnoredChannels(interaction.guildId);

    let currentPage: SettingsPage = "logging";
    const channelPermissions = this.getChannelPermissions(interaction, config);

    const settingsMessage = createSettingsMessage(
      {
        page: currentPage,
        config,
        messageLogBlocks,
        channelPermissions,
        disabled: false,
      },
      interaction,
    );

    const msg = await interaction.reply(settingsMessage);

    const collector = msg.createMessageComponentCollector({
      idle: 120000,
      dispose: true,
    });

    collector.on("collect", async (i) => {
      try {
        this.logger.debug(
          {
            interactionId: i.id,
            customId: i.customId,
            userId: i.user.id,
            guildId: interaction.guildId,
          },
          "Handling settings interaction",
        );

        if (i.user.id !== interaction.user.id) {
          const replied = await i.reply(formatButtonRejectionResponse());
          await sleep(2500);
          await replied.delete();
          return;
        }

        // Handle component interactions (modal submissions are handled separately)
        const updatedPage = await this.handleComponentInteraction(
          i,
          interaction.guildId,
        );

        if (updatedPage) {
          currentPage = updatedPage;
        }
      } catch (err) {
        this.logger.error(err, "Failed to handle settings interaction.");
      }
    });

    collector.on("end", async () => {
      try {
        const currentConfig = await this.guildSettingsService.getGuildSettings(
          interaction.guildId,
        );
        const currentBlocks =
          await this.messageLogBlockService.getIgnoredChannels(
            interaction.guildId,
          );
        const currentChannelPermissions = this.getChannelPermissions(
          interaction,
          currentConfig,
        );

        const disabledMessage = createSettingsMessage(
          {
            page: currentPage,
            config: currentConfig,
            messageLogBlocks: currentBlocks,
            channelPermissions: currentChannelPermissions,
            disabled: true,
          },
          interaction,
        );

        await msg.edit(disabledMessage);
      } catch (err) {
        this.logger.error(err, "Failed to disable settings components.");
      }
    });
  }

  private async handleComponentInteraction(
    interaction: MessageComponentInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage | undefined> {
    if (interaction.isChannelSelectMenu()) {
      return this.handleChannelSelectInteraction(interaction, guildId);
    }

    if (interaction.isButton()) {
      return this.handleButtonInteraction(interaction, guildId);
    }
  }

  private async handleChannelSelectInteraction(
    interaction: ChannelSelectMenuInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage | undefined> {
    // Handle multi-select message log ignore channels
    if (
      interaction.customId === SETTINGS_CUSTOM_IDS.MESSAGE_LOG_IGNORE_CHANNELS
    ) {
      await this.handleMessageLogIgnoreChannels(interaction, guildId);
      return "logging";
    }

    // Handle single-select channel menus for log channels
    return this.handleLogChannelSelection(interaction, guildId);
  }

  private async handleMessageLogIgnoreChannels(
    interaction: ChannelSelectMenuInteraction<"cached">,
    guildId: string,
  ): Promise<void> {
    const selectedChannelIds = interaction.values;
    const currentBlocks =
      await this.messageLogBlockService.getIgnoredChannels(guildId);
    const currentChannelIds = currentBlocks.map((block) => block.channelId);

    // Remove channels that are no longer selected
    for (const block of currentBlocks) {
      if (!selectedChannelIds.includes(block.channelId)) {
        await this.messageLogBlockService.removeIgnoredChannel(
          guildId,
          block.channelId,
        );
      }
    }

    // Add newly selected channels
    for (const channelId of selectedChannelIds) {
      if (!currentChannelIds.includes(channelId)) {
        await this.messageLogBlockService.addIgnoredChannel(guildId, channelId);
      }
    }

    const updatedConfig =
      await this.guildSettingsService.getGuildSettings(guildId);
    const updatedBlocks =
      await this.messageLogBlockService.getIgnoredChannels(guildId);
    const updatedChannelPermissions = this.getChannelPermissions(
      interaction,
      updatedConfig,
    );

    const updatedMessage = createSettingsMessage(
      {
        page: "logging",
        config: updatedConfig,
        messageLogBlocks: updatedBlocks,
        channelPermissions: updatedChannelPermissions,
        disabled: false,
      },
      interaction,
    );

    await interaction.update(updatedMessage);
  }

  private async handleLogChannelSelection(
    interaction: ChannelSelectMenuInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage> {
    const channelId = interaction.values[0] ?? null;
    let logType: "mod" | "member" | "message" | "reaction" | "joinleave";
    let currentPage: SettingsPage;

    switch (interaction.customId) {
      case SETTINGS_CUSTOM_IDS.SET_MOD_LOG_CHANNEL:
        logType = "mod";
        currentPage = "logging";
        break;
      case SETTINGS_CUSTOM_IDS.SET_MEMBER_LOG_CHANNEL:
        logType = "member";
        currentPage = "logging";
        break;
      case SETTINGS_CUSTOM_IDS.SET_MESSAGE_LOG_CHANNEL:
        logType = "message";
        currentPage = "logging";
        break;
      case SETTINGS_CUSTOM_IDS.SET_REACTION_LOG_CHANNEL:
        logType = "reaction";
        currentPage = "logging";
        break;
      case SETTINGS_CUSTOM_IDS.SET_JOIN_LEAVE_CHANNEL:
        logType = "joinleave";
        currentPage = "messages";
        break;
      default:
        throw new Error("Unknown channel select custom ID");
    }

    if (channelId) {
      if (logType === "joinleave") {
        await this.guildSettingsService.updateMessageChannel(guildId, channelId);
      } else {
        await this.guildSettingsService.updateLogChannel(
          guildId,
          logType,
          channelId,
        );
      }
    } else {
      // Handle clearing the channel setting by passing null
      if (logType !== "joinleave") {
        await this.guildSettingsService.updateLogChannel(
          guildId,
          logType,
          null,
        );
      }
      // Note: joinleave channel clearing would need a separate method in the service
      // For now, we skip clearing joinleave channel since the service method doesn't support null
    }

    const updatedConfig =
      await this.guildSettingsService.getGuildSettings(guildId);
    const updatedBlocks =
      await this.messageLogBlockService.getIgnoredChannels(guildId);
    const updatedChannelPermissions = this.getChannelPermissions(
      interaction,
      updatedConfig,
    );

    const updatedMessage = createSettingsMessage(
      {
        page: currentPage,
        config: updatedConfig,
        messageLogBlocks: updatedBlocks,
        channelPermissions: updatedChannelPermissions,
        disabled: false,
      },
      interaction,
    );

    await interaction.update(updatedMessage);
    return currentPage;
  }

  private async handleButtonInteraction(
    interaction: ButtonInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage | undefined> {
    const currentConfig =
      await this.guildSettingsService.getGuildSettings(guildId);

    // Handle navigation buttons
    const navigationPage = this.getPageFromNavigationButton(
      interaction.customId,
    );
    if (navigationPage) {
      const messageLogBlocks =
        await this.messageLogBlockService.getIgnoredChannels(guildId);
      const currentChannelPermissions = this.getChannelPermissions(
        interaction,
        currentConfig,
      );

      const updatedMessage = createSettingsMessage(
        {
          page: navigationPage,
          config: currentConfig,
          messageLogBlocks,
          channelPermissions: currentChannelPermissions,
          disabled: false,
        },
        interaction,
      );

      await interaction.update(updatedMessage);
      return navigationPage;
    }

    // Handle modal-triggering buttons
    if (interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_JOIN_MESSAGE) {
      const modal = createJoinMessageModal(
        currentConfig.messageSettings.joinMessage,
      );
      await interaction.showModal(modal);

      try {
        const modalSubmission = await interaction.awaitModalSubmit({
          time: 120000, // 2 minutes
        });

        if (!modalSubmission.isFromMessage()) {
          throw new Error("Modal submission is not from a message interaction");
        }

        await this.handleModalSubmissionDirect(modalSubmission, guildId);
      } catch (err) {
        this.logger.debug(
          {
            interactionId: interaction.id,
            err,
          },
          "Join message modal submission timed out or failed",
        );
      }

      return undefined; // No page change for modal buttons
    }

    if (interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_LEAVE_MESSAGE) {
      const modal = createLeaveMessageModal(
        currentConfig.messageSettings.leaveMessage,
      );
      await interaction.showModal(modal);

      try {
        const modalSubmission = await interaction.awaitModalSubmit({
          time: 120000, // 2 minutes
        });

        if (!modalSubmission.isFromMessage()) {
          throw new Error("Modal submission is not from a message interaction");
        }

        await this.handleModalSubmissionDirect(modalSubmission, guildId);
      } catch (err) {
        this.logger.debug(
          {
            interactionId: interaction.id,
            err,
          },
          "Leave message modal submission timed out or failed",
        );
      }

      return undefined; // No page change for modal buttons
    }

    if (interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_TIMEOUT_DM_TEXT) {
      const modal = createTimeoutDmTextModal(
        currentConfig.moderationSettings.timeoutDmText,
      );
      await interaction.showModal(modal);

      try {
        const modalSubmission = await interaction.awaitModalSubmit({
          time: 120000, // 2 minutes
        });

        if (!modalSubmission.isFromMessage()) {
          throw new Error("Modal submission is not from a message interaction");
        }

        await this.handleModalSubmissionDirect(modalSubmission, guildId);
      } catch (err) {
        this.logger.debug(
          {
            interactionId: interaction.id,
            err,
          },
          "Timeout DM text modal submission timed out or failed",
        );
      }

      return undefined; // No page change for modal buttons
    }

    if (interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_WARN_DM_TEXT) {
      const modal = createWarnDmTextModal(
        currentConfig.moderationSettings.warnDmText,
      );
      await interaction.showModal(modal);

      try {
        const modalSubmission = await interaction.awaitModalSubmit({
          time: 120000, // 2 minutes
        });

        if (!modalSubmission.isFromMessage()) {
          throw new Error("Modal submission is not from a message interaction");
        }

        await this.handleModalSubmissionDirect(modalSubmission, guildId);
      } catch (err) {
        this.logger.debug(
          {
            interactionId: interaction.id,
            err,
          },
          "Warn DM text modal submission timed out or failed",
        );
      }

      return undefined; // No page change for modal buttons
    }

    if (interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_BAN_DM_TEXT) {
      const modal = createBanDmTextModal(
        currentConfig.moderationSettings.banDmText,
      );
      await interaction.showModal(modal);

      try {
        const modalSubmission = await interaction.awaitModalSubmit({
          time: 120000, // 2 minutes
        });

        if (!modalSubmission.isFromMessage()) {
          throw new Error("Modal submission is not from a message interaction");
        }

        await this.handleModalSubmissionDirect(modalSubmission, guildId);
      } catch (err) {
        this.logger.debug(
          {
            interactionId: interaction.id,
            err,
          },
          "Ban DM text modal submission timed out or failed",
        );
      }

      return undefined; // No page change for modal buttons
    }

    // Handle toggle buttons
    const { setting, page } = this.getSettingAndPageFromButton(
      interaction.customId,
    );

    if (!setting) {
      throw new Error("Unknown button custom ID");
    }

    const updatedConfig = await this.guildSettingsService.toggleSetting(
      guildId,
      setting,
    );
    const messageLogBlocks =
      await this.messageLogBlockService.getIgnoredChannels(guildId);
    const updatedChannelPermissions = this.getChannelPermissions(
      interaction,
      updatedConfig,
    );

    const updatedMessage = createSettingsMessage(
      {
        page,
        config: updatedConfig,
        messageLogBlocks,
        channelPermissions: updatedChannelPermissions,
        disabled: false,
      },
      interaction,
    );

    await interaction.update(updatedMessage);
    return page;
  }

  private getPageFromNavigationButton(customId: string): SettingsPage | null {
    switch (customId) {
      case SETTINGS_CUSTOM_IDS.NAVIGATION_LOGGING:
        return "logging";
      case SETTINGS_CUSTOM_IDS.NAVIGATION_MODERATION:
        return "moderation";
      case SETTINGS_CUSTOM_IDS.NAVIGATION_MESSAGES:
        return "messages";
      case SETTINGS_CUSTOM_IDS.NAVIGATION_ADVANCED:
        return "advanced";
      default:
        return null;
    }
  }

  private getSettingAndPageFromButton(customId: string): {
    setting: ToggleableSetting | null;
    page: SettingsPage;
  } {
    switch (customId) {
      case SETTINGS_CUSTOM_IDS.TOGGLE_MOD_LOG:
        return { setting: "modLog", page: "logging" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_MEMBER_LOG:
        return { setting: "memberLog", page: "logging" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_MESSAGE_LOG:
        return { setting: "messageLog", page: "logging" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_REACTION_LOG:
        return { setting: "reactionLog", page: "logging" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_JOIN_MSG:
        return { setting: "joinMessage", page: "messages" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_LEAVE_MSG:
        return { setting: "leaveMessage", page: "messages" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_LOOKUP_OPT_IN:
        return { setting: "lookupOptIn", page: "moderation" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_TIMEOUT_COMMAND_DM:
        return { setting: "timeoutCommandDm", page: "moderation" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_TIMEOUT_NATIVE_DM:
        return { setting: "timeoutNativeDm", page: "moderation" };
      case SETTINGS_CUSTOM_IDS.TOGGLE_BAN_DM:
        return { setting: "banDm", page: "moderation" };
      default:
        this.logger.warn(
          { customId },
          "Unknown button custom ID for toggle setting",
        );
        return { setting: null, page: "logging" };
    }
  }

  private async handleModalSubmissionDirect(
    interaction: ModalMessageModalSubmitInteraction<"cached">,
    guildId: string,
  ): Promise<void> {
    let targetPage: SettingsPage = "messages";

    if (interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_JOIN_MESSAGE) {
      const newMessage =
        interaction.fields.getTextInputValue("join_message_input");
      await this.guildSettingsService.updateJoinMessage(guildId, newMessage);
      targetPage = "messages";
    } else if (
      interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_LEAVE_MESSAGE
    ) {
      const newMessage = interaction.fields.getTextInputValue(
        "leave_message_input",
      );
      await this.guildSettingsService.updateLeaveMessage(guildId, newMessage);
      targetPage = "messages";
    } else if (
      interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_TIMEOUT_DM_TEXT
    ) {
      const newText = interaction.fields.getTextInputValue(
        "timeout_dm_text_input",
      );
      await this.guildSettingsService.updateTimeoutDmText(guildId, newText);
      targetPage = "moderation";
    } else if (interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_WARN_DM_TEXT) {
      const newText =
        interaction.fields.getTextInputValue("warn_dm_text_input");
      await this.guildSettingsService.updateWarnDmText(guildId, newText);
      targetPage = "moderation";
    } else if (interaction.customId === SETTINGS_CUSTOM_IDS.EDIT_BAN_DM_TEXT) {
      const newText = interaction.fields.getTextInputValue("ban_dm_text_input");
      await this.guildSettingsService.updateBanDmText(guildId, newText);
      targetPage = "moderation";
    }

    // Update the original settings panel with the new config
    const updatedConfig =
      await this.guildSettingsService.getGuildSettings(guildId);
    const messageLogBlocks =
      await this.messageLogBlockService.getIgnoredChannels(guildId);
    const updatedChannelPermissions = this.getChannelPermissions(
      interaction,
      updatedConfig,
    );

    const updatedMessage = createSettingsMessage(
      {
        page: targetPage,
        config: updatedConfig,
        messageLogBlocks,
        channelPermissions: updatedChannelPermissions,
        disabled: false,
      },
      interaction,
    );

    await interaction.update(updatedMessage);
  }
}
