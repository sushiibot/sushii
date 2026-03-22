import type { GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { SpamActionService } from "../../application/SpamActionService";
import type { SpamDetectionService } from "../../application/SpamDetectionService";

export class AutomodMessageHandler extends EventHandler<Events.Raw> {
  constructor(
    private readonly spamDetectionService: SpamDetectionService,
    private readonly spamActionService: SpamActionService,
    private readonly guildConfigRepository: GuildConfigRepository,
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

    const payload = event.d;

    // Ignore DMs
    if (!payload.guild_id) {
      return;
    }

    // Ignore bots
    if (payload.author.bot) {
      return;
    }

    // Derive spam key from content and/or attachment filenames so messages
    // with the same combination of text + files hash identically across channels
    const contentPart = payload.content?.trim();
    const attachmentPart = payload.attachments?.length
      ? payload.attachments.map((a) => a.filename).sort().join(",")
      : undefined;
    const spamKey = [contentPart, attachmentPart]
      .filter((s): s is string => Boolean(s))
      .join("|");

    // Ignore messages with no content and no attachments
    if (!spamKey) {
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
      const spamMessages = this.spamDetectionService.checkForSpam(
        payload.guild_id,
        payload.author.id,
        spamKey,
        payload.channel_id,
        payload.id,
      );

      if (spamMessages) {
        await this.spamActionService.executeSpamAction(
          payload.guild_id,
          payload.author.id,
          payload.author.username,
          spamMessages,
          guildConfig.moderationSettings.automodAlertsChannelId,
        );
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
}
