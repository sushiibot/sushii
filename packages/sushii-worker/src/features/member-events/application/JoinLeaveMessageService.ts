import type { GuildMember, PartialGuildMember } from "discord.js";
import type { Logger } from "pino";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { MessageTemplateService } from "../domain";

export class JoinLeaveMessageService {
  constructor(
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly templateService: MessageTemplateService,
    private readonly logger: Logger,
  ) {}

  async sendJoinMessage(member: GuildMember): Promise<void> {
    const config = await this.guildConfigRepository.findByGuildId(
      member.guild.id,
    );

    if (!config.messageSettings.messageChannel) {
      return;
    }

    if (
      !config.messageSettings.joinMessageEnabled ||
      !config.messageSettings.joinMessage
    ) {
      return;
    }

    const channel = member.guild.channels.cache.get(
      config.messageSettings.messageChannel,
    );
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const message = this.templateService.replaceTemplate(
      config.messageSettings.joinMessage,
      member,
    );

    try {
      await channel.send(message);
    } catch (err) {
      this.logger.warn(
        {
          err,
          guildId: member.guild.id,
          channelId: channel.id,
        },
        "Failed to send join message",
      );
    }
  }

  async sendLeaveMessage(
    member: GuildMember | PartialGuildMember,
  ): Promise<void> {
    const config = await this.guildConfigRepository.findByGuildId(
      member.guild.id,
    );

    if (!config.messageSettings.messageChannel) {
      return;
    }

    if (
      !config.messageSettings.leaveMessageEnabled ||
      !config.messageSettings.leaveMessage
    ) {
      return;
    }

    const channel = member.guild.channels.cache.get(
      config.messageSettings.messageChannel,
    );
    if (!channel || !channel.isTextBased()) {
      return;
    }

    const message = this.templateService.replaceTemplate(
      config.messageSettings.leaveMessage,
      member,
    );

    try {
      await channel.send(message);
    } catch (err) {
      this.logger.warn(
        {
          err,
          guildId: member.guild.id,
          channelId: channel.id,
        },
        "Failed to send leave message",
      );
    }
  }
}
