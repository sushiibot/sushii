import { Logger } from "pino";

import { GuildConfig, ToggleableSetting } from "../domain/entities/GuildConfig";
import { GuildConfigurationRepository } from "../domain/repositories/GuildConfigurationRepository";

export class GuildSettingsService {
  constructor(
    private readonly guildConfigRepository: GuildConfigurationRepository,
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
        updatedConfig = config.toggleJoinMessage();
        break;
      case "leaveMessage":
        updatedConfig = config.toggleLeaveMessage();
        break;
      case "modLog":
        updatedConfig = config.toggleModLog();
        break;
      case "memberLog":
        updatedConfig = config.toggleMemberLog();
        break;
      case "messageLog":
        updatedConfig = config.toggleMessageLog();
        break;
      case "lookupOptIn":
        updatedConfig = config.toggleLookupOptIn();
        break;
      case "timeoutCommandDm":
        updatedConfig = config.toggleTimeoutCommandDm();
        break;
      case "timeoutNativeDm":
        updatedConfig = config.toggleTimeoutNativeDm();
        break;
      case "banDm":
        updatedConfig = config.toggleBanDm();
        break;
    }

    return this.guildConfigRepository.save(updatedConfig);
  }
}
