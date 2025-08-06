import {
  ChannelType,
  Client,
  DiscordAPIError,
  GuildTextBasedChannel,
} from "discord.js";
import { Logger } from "pino";
import { Err, Ok, Result } from "ts-results";

import { ChannelService } from "../../domain/services/ChannelService";
import { ChannelSlowmode } from "../../domain/value-objects/ChannelSlowmode";

export class DiscordChannelService implements ChannelService {
  constructor(
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  async setSlowmode(
    channelId: string,
    slowmode: ChannelSlowmode,
  ): Promise<Result<void, string>> {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel) {
        return Err("Channel not found");
      }

      if (!this.isTextChannel(channel)) {
        return Err("Channel is not a text channel");
      }

      await channel.edit({
        rateLimitPerUser: slowmode.asSeconds,
      });

      this.logger.debug(
        {
          channelId,
          slowmodeSeconds: slowmode.asSeconds,
        },
        "Updated channel slowmode",
      );

      return Ok.EMPTY;
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        this.logger.warn(
          { error: error.message, channelId },
          "Discord API error updating slowmode",
        );
        return Err(`Failed to update slowmode: ${error.message}`);
      }

      this.logger.error(
        { error, channelId },
        "Unexpected error updating slowmode",
      );
      return Err(`Unexpected error updating slowmode: ${error}`);
    }
  }

  async getSlowmode(
    channelId: string,
  ): Promise<Result<ChannelSlowmode, string>> {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel) {
        return Err("Channel not found");
      }

      if (!this.isTextChannel(channel)) {
        return Err("Channel is not a text channel");
      }

      const slowmodeResult = ChannelSlowmode.fromSeconds(
        channel.rateLimitPerUser || 0,
      );

      if (slowmodeResult.err) {
        return Err(slowmodeResult.val);
      }

      return Ok(slowmodeResult.val);
    } catch (error) {
      this.logger.error({ error, channelId }, "Failed to get channel slowmode");
      return Err(`Failed to get channel slowmode: ${error}`);
    }
  }

  async exists(channelId: string): Promise<Result<boolean, string>> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      return Ok(channel !== null);
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === 10003) {
        // Unknown channel
        return Ok(false);
      }

      this.logger.error(
        { error, channelId },
        "Failed to check channel existence",
      );
      return Err(`Failed to check channel existence: ${error}`);
    }
  }

  async getChannelName(channelId: string): Promise<Result<string, string>> {
    try {
      const channel = await this.client.channels.fetch(channelId);

      if (!channel) {
        return Err("Channel not found");
      }

      if (channel.isDMBased()) {
        return Ok("DM Channel");
      }

      return Ok(channel.name || "Unknown Channel");
    } catch (error) {
      this.logger.error({ error, channelId }, "Failed to get channel name");
      return Err(`Failed to get channel name: ${error}`);
    }
  }

  private isTextChannel(channel: any): channel is GuildTextBasedChannel {
    return (
      channel.type === ChannelType.GuildText ||
      channel.type === ChannelType.GuildAnnouncement ||
      channel.type === ChannelType.PublicThread ||
      channel.type === ChannelType.PrivateThread ||
      channel.type === ChannelType.AnnouncementThread
    );
  }
}
