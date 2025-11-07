import type { Client, GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { SpamDetectionService } from "../../application/SpamDetectionService";

interface GuildMessageCreatePayload {
  id: string;
  channel_id: string;
  guild_id: string;
  author: {
    id: string;
    username: string;
    bot?: boolean;
  };
  content?: string;
}

export class AutomodMessageHandler extends EventHandler<Events.Raw> {
  constructor(
    private readonly spamDetectionService: SpamDetectionService,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.Raw;

  async handle(event: GatewayDispatchPayload): Promise<void> {
    // Only process message create events
    if (event.t !== GatewayDispatchEvents.MessageCreate) {
      return;
    }

    const payload = event.d as GuildMessageCreatePayload;

    // Ignore DMs
    if (!payload.guild_id) {
      return;
    }

    // Ignore bots
    if (payload.author.bot) {
      return;
    }

    // Ignore messages without content
    if (!payload.content?.trim()) {
      return;
    }

    try {
      // Check if guild has automod enabled
      const guildConfig = await this.guildConfigRepository.findByGuildId(
        payload.guild_id,
      );

      if (!guildConfig.moderationSettings.automodSpamEnabled) {
        return;
      }

      // Check for spam
      const isSpam = this.spamDetectionService.checkForSpam(
        payload.guild_id,
        payload.author.id,
        payload.content,
        payload.channel_id,
      );

      if (isSpam) {
        await this.handleSpamDetected(payload);
      }
    } catch (err) {
      this.logger.error(
        {
          err,
          messageId: payload.id,
          guildId: payload.guild_id,
          userId: payload.author.id,
        },
        "Failed to process message for automod spam detection",
      );
    }
  }

  private async handleSpamDetected(
    payload: GuildMessageCreatePayload,
  ): Promise<void> {
    try {
      // Get the guild and member to timeout
      const guild = this.client.guilds.cache.get(payload.guild_id);
      if (!guild) {
        this.logger.warn(
          { guildId: payload.guild_id },
          "Guild not found in cache for spam timeout",
        );
        return;
      }

      const member = await guild.members
        .fetch(payload.author.id)
        .catch(() => null);
      if (!member) {
        this.logger.warn(
          { guildId: payload.guild_id, userId: payload.author.id },
          "Member not found for spam timeout",
        );
        return;
      }

      // Check if member can be timed out
      if (!member.moderatable) {
        this.logger.info(
          { guildId: payload.guild_id, userId: payload.author.id },
          "Member is not moderatable for spam timeout",
        );

        return;
      }

      // Timeout for 10 minutes with clear audit log reason
      const timeoutDuration = 10 * 60 * 1000; // 10 minutes in milliseconds
      const reason =
        "Automatic timeout: duplicate message spam detected across multiple channels";

      await member.timeout(timeoutDuration, reason);

      this.logger.info(
        {
          guildId: payload.guild_id,
          userId: payload.author.id,
          username: payload.author.username,
          timeoutDuration,
        },
        "Applied automatic timeout for spam detection",
      );
    } catch (err) {
      this.logger.error(
        {
          err,
          guildId: payload.guild_id,
          userId: payload.author.id,
        },
        "Failed to timeout user for spam",
      );
    }
  }
}
