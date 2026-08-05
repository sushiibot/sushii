import { sleep } from "bun";
import type {
  ButtonInteraction,
  ChannelSelectMenuInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalBuilder,
  RoleSelectMenuInteraction,
} from "discord.js";
import {
  ApplicationIntegrationType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import type { ModalMessageModalSubmitInteraction } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
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
import { SETTINGS_TAB_BY_CUSTOM_ID } from "../views/components/SettingsChrome";
import {
  createBanDmTextModal,
  createJoinMessageModal,
  createKickDmTextModal,
  createLeaveMessageModal,
  createTimeoutDmTextModal,
  createWarnDmTextModal,
} from "../views/components/SettingsComponents";
import type { SettingsPage } from "../views/components/SettingsConstants";
import {
  MODAL_TARGET_PAGE_BY_CUSTOM_ID,
  SETTINGS_CUSTOM_IDS,
  SETTINGS_EMOJI_NAMES,
  TOGGLE_SETTING_PAGE_BY_CUSTOM_ID,
} from "../views/components/SettingsConstants";

export default class SettingsCommand extends SlashCommandHandler {
  constructor(
    private readonly guildSettingsService: GuildSettingsService,
    private readonly messageLogBlockService: MessageLogBlockService,
    private readonly logger: Logger,
    private readonly emojiRepository: BotEmojiRepository,
  ) {
    super();
  }

  private async getEmojis() {
    return this.emojiRepository.getEmojis(SETTINGS_EMOJI_NAMES);
  }

  command = new SlashCommandBuilder()
    .setName("settings")
    .setDescription("Configure sushii server settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
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
    if (config.moderationSettings.automodAlertsChannelId) {
      channelIds.push(config.moderationSettings.automodAlertsChannelId);
    }

    const uniqueChannelIds = [...new Set(channelIds)];
    return checkMultipleChannelsPermissions(
      interaction.guild,
      uniqueChannelIds,
    );
  }

  private async renderPage(
    page: SettingsPage,
    interaction:
      | ButtonInteraction<"cached">
      | ChannelSelectMenuInteraction<"cached">
      | RoleSelectMenuInteraction<"cached">
      | ModalMessageModalSubmitInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage> {
    const [config, messageLogBlocks, emojis] = await Promise.all([
      this.guildSettingsService.getGuildSettings(guildId),
      this.messageLogBlockService.getIgnoredChannels(guildId),
      this.getEmojis(),
    ]);
    const channelPermissions = this.getChannelPermissions(interaction, config);

    const updatedMessage = createSettingsMessage(
      {
        page,
        config,
        messageLogBlocks,
        channelPermissions,
        disabled: false,
        emojis,
      },
      interaction,
    );

    await interaction.update(updatedMessage);
    return page;
  }

  private async showSettingsPanel(
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const [config, messageLogBlocks, emojis] = await Promise.all([
      this.guildSettingsService.getGuildSettings(interaction.guildId),
      this.messageLogBlockService.getIgnoredChannels(interaction.guildId),
      this.getEmojis(),
    ]);

    let currentPage: SettingsPage = "overview";
    const channelPermissions = this.getChannelPermissions(interaction, config);

    const settingsMessage = createSettingsMessage(
      {
        page: currentPage,
        config,
        messageLogBlocks,
        channelPermissions,
        disabled: false,
        emojis,
      },
      interaction,
    );

    const msg = await interaction.reply(settingsMessage);

    const collector = msg.createMessageComponentCollector({
      idle: 300000,
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

    // Edits via `msg.edit()`, not `renderPage`/`interaction.update()` — there's
    // no live interaction to update once the collector has expired.
    collector.on("end", async () => {
      try {
        const [currentConfig, currentBlocks, currentEmojis] = await Promise.all(
          [
            this.guildSettingsService.getGuildSettings(interaction.guildId),
            this.messageLogBlockService.getIgnoredChannels(interaction.guildId),
            this.getEmojis(),
          ],
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
            emojis: currentEmojis,
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

    if (interaction.isRoleSelectMenu()) {
      return this.handleRoleSelectInteraction(interaction, guildId);
    }

    if (interaction.isButton()) {
      return this.handleButtonInteraction(interaction, guildId);
    }
  }

  private async handleChannelSelectInteraction(
    interaction: ChannelSelectMenuInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage | undefined> {
    if (
      interaction.customId === SETTINGS_CUSTOM_IDS.CHANNELS.MESSAGE_LOG_IGNORE
    ) {
      return this.handleMessageLogIgnoreChannels(interaction, guildId);
    }

    if (
      interaction.customId === SETTINGS_CUSTOM_IDS.CHANNELS.SET_AUTOMOD_ALERTS
    ) {
      return this.handleAutomodAlertsChannelSelection(interaction, guildId);
    }

    return this.handleLogChannelSelection(interaction, guildId);
  }

  private async handleAutomodAlertsChannelSelection(
    interaction: ChannelSelectMenuInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage> {
    const channelId = interaction.values[0] ?? null;
    await this.guildSettingsService.updateAutomodAlertsChannel(
      guildId,
      channelId,
    );

    return this.renderPage("automod", interaction, guildId);
  }

  private async handleRoleSelectInteraction(
    interaction: RoleSelectMenuInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage | undefined> {
    if (
      interaction.customId !==
      SETTINGS_CUSTOM_IDS.ROLES.SET_AUTOMOD_EXEMPT_ROLES
    ) {
      return undefined;
    }

    const roleIds = interaction.values.filter((id) => id !== guildId);
    await this.guildSettingsService.updateAutomodExemptRoles(guildId, roleIds);

    return this.renderPage("automod", interaction, guildId);
  }

  private async handleMessageLogIgnoreChannels(
    interaction: ChannelSelectMenuInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage> {
    const selectedChannelIds = interaction.values;
    const currentBlocks =
      await this.messageLogBlockService.getIgnoredChannels(guildId);
    const currentChannelIds = currentBlocks.map((block) => block.channelId);

    for (const block of currentBlocks) {
      if (!selectedChannelIds.includes(block.channelId)) {
        await this.messageLogBlockService.removeIgnoredChannel(
          guildId,
          block.channelId,
        );
      }
    }

    for (const channelId of selectedChannelIds) {
      if (!currentChannelIds.includes(channelId)) {
        await this.messageLogBlockService.addIgnoredChannel(guildId, channelId);
      }
    }

    return this.renderPage("logging", interaction, guildId);
  }

  private async handleLogChannelSelection(
    interaction: ChannelSelectMenuInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage> {
    const channelId = interaction.values[0] ?? null;
    let logType: "mod" | "member" | "message" | "reaction" | "joinleave";
    let currentPage: SettingsPage;

    switch (interaction.customId) {
      case SETTINGS_CUSTOM_IDS.CHANNELS.SET_MOD_LOG:
        logType = "mod";
        currentPage = "logging";
        break;
      case SETTINGS_CUSTOM_IDS.CHANNELS.SET_MEMBER_LOG:
        logType = "member";
        currentPage = "logging";
        break;
      case SETTINGS_CUSTOM_IDS.CHANNELS.SET_MESSAGE_LOG:
        logType = "message";
        currentPage = "logging";
        break;
      case SETTINGS_CUSTOM_IDS.CHANNELS.SET_REACTION_LOG:
        logType = "reaction";
        currentPage = "logging";
        break;
      case SETTINGS_CUSTOM_IDS.CHANNELS.SET_JOIN_LEAVE:
        logType = "joinleave";
        currentPage = "messages";
        break;
      default:
        throw new Error("Unknown channel select custom ID");
    }

    if (logType === "joinleave") {
      await this.guildSettingsService.updateMessageChannel(guildId, channelId);
    } else {
      await this.guildSettingsService.updateLogChannel(
        guildId,
        logType,
        channelId,
      );
    }

    return this.renderPage(currentPage, interaction, guildId);
  }

  /**
   * Shows the modal and awaits its submission, filtered to this user and this
   * exact modal — without both filters, `awaitModalSubmit` accepts the first
   * matching-type submission from anyone on the shard, which could apply
   * another user's guild's edit here and overwrite their in-progress panel.
   */
  private async openModalAndAwaitSubmission(
    interaction: ButtonInteraction<"cached">,
    modal: ModalBuilder,
    modalCustomId: string,
    guildId: string,
    timeoutLogMessage: string,
  ): Promise<SettingsPage | undefined> {
    await interaction.showModal(modal);

    try {
      const modalSubmission = await interaction.awaitModalSubmit({
        time: 300000,
        filter: (i) =>
          i.user.id === interaction.user.id && i.customId === modalCustomId,
      });

      if (!modalSubmission.isFromMessage()) {
        throw new Error("Modal submission is not from a message interaction");
      }

      return await this.handleModalSubmissionDirect(modalSubmission, guildId);
    } catch (err) {
      this.logger.debug(
        { interactionId: interaction.id, err },
        timeoutLogMessage,
      );
      return undefined;
    }
  }

  private async handleButtonInteraction(
    interaction: ButtonInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage | undefined> {
    const tabPage = SETTINGS_TAB_BY_CUSTOM_ID.get(interaction.customId);
    if (tabPage) {
      return this.renderPage(tabPage, interaction, guildId);
    }

    const currentConfig =
      await this.guildSettingsService.getGuildSettings(guildId);

    // Handle modal-triggering buttons
    if (interaction.customId === SETTINGS_CUSTOM_IDS.MODALS.EDIT_JOIN_MESSAGE) {
      const modal = createJoinMessageModal(
        currentConfig.messageSettings.joinMessage,
      );
      return this.openModalAndAwaitSubmission(
        interaction,
        modal,
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_JOIN_MESSAGE,
        guildId,
        "Join message modal submission timed out or failed",
      );
    }

    if (
      interaction.customId === SETTINGS_CUSTOM_IDS.MODALS.EDIT_LEAVE_MESSAGE
    ) {
      const modal = createLeaveMessageModal(
        currentConfig.messageSettings.leaveMessage,
      );
      return this.openModalAndAwaitSubmission(
        interaction,
        modal,
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_LEAVE_MESSAGE,
        guildId,
        "Leave message modal submission timed out or failed",
      );
    }

    if (
      interaction.customId === SETTINGS_CUSTOM_IDS.MODALS.EDIT_TIMEOUT_DM_TEXT
    ) {
      const modal = createTimeoutDmTextModal(
        currentConfig.moderationSettings.timeoutDmText,
      );
      return this.openModalAndAwaitSubmission(
        interaction,
        modal,
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_TIMEOUT_DM_TEXT,
        guildId,
        "Timeout DM text modal submission timed out or failed",
      );
    }

    if (interaction.customId === SETTINGS_CUSTOM_IDS.MODALS.EDIT_WARN_DM_TEXT) {
      const modal = createWarnDmTextModal(
        currentConfig.moderationSettings.warnDmText,
      );
      return this.openModalAndAwaitSubmission(
        interaction,
        modal,
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_WARN_DM_TEXT,
        guildId,
        "Warn DM text modal submission timed out or failed",
      );
    }

    if (interaction.customId === SETTINGS_CUSTOM_IDS.MODALS.EDIT_BAN_DM_TEXT) {
      const modal = createBanDmTextModal(
        currentConfig.moderationSettings.banDmText,
      );
      return this.openModalAndAwaitSubmission(
        interaction,
        modal,
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_BAN_DM_TEXT,
        guildId,
        "Ban DM text modal submission timed out or failed",
      );
    }

    if (interaction.customId === SETTINGS_CUSTOM_IDS.MODALS.EDIT_KICK_DM_TEXT) {
      const modal = createKickDmTextModal(
        currentConfig.moderationSettings.kickDmText,
      );
      return this.openModalAndAwaitSubmission(
        interaction,
        modal,
        SETTINGS_CUSTOM_IDS.MODALS.EDIT_KICK_DM_TEXT,
        guildId,
        "Kick DM text modal submission timed out or failed",
      );
    }

    // Handle toggle buttons
    const toggle = TOGGLE_SETTING_PAGE_BY_CUSTOM_ID.get(interaction.customId);
    if (!toggle) {
      throw new Error("Unknown button custom ID");
    }

    await this.guildSettingsService.toggleSetting(guildId, toggle.setting);
    return this.renderPage(toggle.page, interaction, guildId);
  }

  private async handleModalSubmissionDirect(
    interaction: ModalMessageModalSubmitInteraction<"cached">,
    guildId: string,
  ): Promise<SettingsPage> {
    const targetPage = MODAL_TARGET_PAGE_BY_CUSTOM_ID.get(interaction.customId);
    if (!targetPage) {
      throw new Error("Unknown settings modal custom ID");
    }

    switch (interaction.customId) {
      case SETTINGS_CUSTOM_IDS.MODALS.EDIT_JOIN_MESSAGE: {
        const newMessage =
          interaction.fields.getTextInputValue("join_message_input");
        await this.guildSettingsService.updateJoinMessage(guildId, newMessage);
        break;
      }
      case SETTINGS_CUSTOM_IDS.MODALS.EDIT_LEAVE_MESSAGE: {
        const newMessage = interaction.fields.getTextInputValue(
          "leave_message_input",
        );
        await this.guildSettingsService.updateLeaveMessage(guildId, newMessage);
        break;
      }
      case SETTINGS_CUSTOM_IDS.MODALS.EDIT_TIMEOUT_DM_TEXT: {
        const newText = interaction.fields.getTextInputValue(
          "timeout_dm_text_input",
        );
        await this.guildSettingsService.updateTimeoutDmText(guildId, newText);
        break;
      }
      case SETTINGS_CUSTOM_IDS.MODALS.EDIT_WARN_DM_TEXT: {
        const newText =
          interaction.fields.getTextInputValue("warn_dm_text_input");
        await this.guildSettingsService.updateWarnDmText(guildId, newText);
        break;
      }
      case SETTINGS_CUSTOM_IDS.MODALS.EDIT_BAN_DM_TEXT: {
        const newText =
          interaction.fields.getTextInputValue("ban_dm_text_input");
        await this.guildSettingsService.updateBanDmText(guildId, newText);
        break;
      }
      case SETTINGS_CUSTOM_IDS.MODALS.EDIT_KICK_DM_TEXT: {
        const newText =
          interaction.fields.getTextInputValue("kick_dm_text_input");
        await this.guildSettingsService.updateKickDmText(guildId, newText);
        break;
      }
      default:
        throw new Error("Unknown settings modal custom ID");
    }

    return this.renderPage(targetPage, interaction, guildId);
  }
}
