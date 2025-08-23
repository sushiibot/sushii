import type { Logger } from "pino";

import type {
  GuildConfig,
  ToggleableSetting,
} from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

export class GuildSettingsService {
  constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  async getGuildSettings(guildId: string): Promise<GuildConfig> {
    return this.guildConfigRepository.findByGuildId(guildId);
  }

  async updateJoinMessage(
    guildId: string,
    message: string,
  ): Promise<GuildConfig> {
    this.logger.info({ guildId, message }, "Updating join message");

    const config = await this.guildConfigRepository.findByGuildId(guildId);
    const updatedConfig = config.updateJoinMessage(message);

    return this.guildConfigRepository.save(updatedConfig);
  }

  async updateLeaveMessage(
    guildId: string,
    message: string,
  ): Promise<GuildConfig> {
    this.logger.info({ guildId, message }, "Updating leave message");

    const config = await this.guildConfigRepository.findByGuildId(guildId);
    const updatedConfig = config.updateLeaveMessage(message);

    return this.guildConfigRepository.save(updatedConfig);
  }

  async updateTimeoutDmText(
    guildId: string,
    text: string,
  ): Promise<GuildConfig> {
    this.logger.info({ guildId, text }, "Updating timeout DM text");

    const config = await this.guildConfigRepository.findByGuildId(guildId);
    const updatedConfig = config.updateTimeoutDmText(text);

    return this.guildConfigRepository.save(updatedConfig);
  }

  async updateWarnDmText(guildId: string, text: string): Promise<GuildConfig> {
    this.logger.info({ guildId, text }, "Updating warn DM text");

    const config = await this.guildConfigRepository.findByGuildId(guildId);
    const updatedConfig = config.updateWarnDmText(text);

    return this.guildConfigRepository.save(updatedConfig);
  }

  async updateBanDmText(guildId: string, text: string): Promise<GuildConfig> {
    this.logger.info({ guildId, text }, "Updating ban DM text");

    const config = await this.guildConfigRepository.findByGuildId(guildId);
    const updatedConfig = config.updateBanDmText(text);

    return this.guildConfigRepository.save(updatedConfig);
  }

  async updateMessageChannel(
    guildId: string,
    channelId: string,
  ): Promise<GuildConfig> {
    this.logger.info({ guildId, channelId }, "Updating message channel");

    const config = await this.guildConfigRepository.findByGuildId(guildId);
    const updatedConfig = config.updateMessageChannel(channelId);

    return this.guildConfigRepository.save(updatedConfig);
  }

  async updateLogChannel(
    guildId: string,
    type: "mod" | "member" | "message",
    channelId: string,
  ): Promise<GuildConfig> {
    this.logger.info({ guildId, type, channelId }, "Updating log channel");

    const config = await this.guildConfigRepository.findByGuildId(guildId);
    const updatedConfig = config.updateLogChannel(type, channelId);

    return this.guildConfigRepository.save(updatedConfig);
  }

  async toggleSetting(
    guildId: string,
    setting: ToggleableSetting,
  ): Promise<GuildConfig> {
    this.logger.info({ guildId, setting }, "Toggling setting");

    const config = await this.guildConfigRepository.findByGuildId(guildId);

    let updatedConfig: GuildConfig;
    switch (setting) {
      case "joinMessage":
        updatedConfig = config.setJoinMessageEnabled(
          !config.messageSettings.joinMessageEnabled,
        );
        break;
      case "leaveMessage":
        updatedConfig = config.setLeaveMessageEnabled(
          !config.messageSettings.leaveMessageEnabled,
        );
        break;
      case "modLog":
        updatedConfig = config.setModLogEnabled(
          !config.loggingSettings.modLogEnabled,
        );
        break;
      case "memberLog":
        updatedConfig = config.setMemberLogEnabled(
          !config.loggingSettings.memberLogEnabled,
        );
        break;
      case "messageLog":
        updatedConfig = config.setMessageLogEnabled(
          !config.loggingSettings.messageLogEnabled,
        );
        break;
      case "reactionLog":
        updatedConfig = config.setReactionLogEnabled(
          !config.loggingSettings.reactionLogEnabled,
        );
        break;
      case "lookupOptIn":
        updatedConfig = config.setLookupOptInEnabled(
          !config.moderationSettings.lookupDetailsOptIn,
        );
        break;
      case "timeoutCommandDm":
        updatedConfig = config.setTimeoutCommandDmEnabled(
          !config.moderationSettings.timeoutCommandDmEnabled,
        );
        break;
      case "timeoutNativeDm":
        updatedConfig = config.setTimeoutNativeDmEnabled(
          !config.moderationSettings.timeoutNativeDmEnabled,
        );
        break;
      case "banDm":
        updatedConfig = config.setBanDmEnabled(
          !config.moderationSettings.banDmEnabled,
        );
        break;
    }

    return this.guildConfigRepository.save(updatedConfig);
  }
}
