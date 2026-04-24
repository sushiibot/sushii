import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

const tracer = opentelemetry.trace.getTracer("automod");
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { SpamActionService } from "../../application/SpamActionService";
import type { SpamDetectionService } from "../../application/SpamDetectionService";

const TEST_GUILD_ID = "167058919611564043";
const TEST_TRIGGER = "__automod_test__";

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
    const guildId = payload.guild_id;

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
        guildId,
      );

      if (guildId === TEST_GUILD_ID && payload.content?.trim() === TEST_TRIGGER) {
        await this.spamActionService.executeSpamAction(
          guildId,
          payload.author.id,
          payload.author.username,
          new Map([[payload.channel_id, [payload.id]]]),
          payload.content,
          [],
          guildConfig.moderationSettings.automodAlertsChannelId,
        );
        return;
      }

      if (!guildConfig.moderationSettings.automodSpamEnabled) {
        return;
      }

      // Check for spam
      const spamMessages = this.spamDetectionService.checkForSpam(
        guildId,
        payload.author.id,
        spamKey,
        payload.channel_id,
        payload.id,
      );

      if (spamMessages) {
        const attachments = (payload.attachments ?? []).map(
          (a: { filename: string; url: string }) => ({
            filename: a.filename,
            url: a.url,
          }),
        );
        await tracer.startActiveSpan("automod.spam-action", async (span) => {
          span.setAttributes({
            "guild.id": guildId,
            "user.id": payload.author.id,
            "spam.channel_count": spamMessages.size,
          });
          try {
            await this.spamActionService.executeSpamAction(
              guildId,
              payload.author.id,
              payload.author.username,
              spamMessages,
              contentPart ?? null,
              attachments,
              guildConfig.moderationSettings.automodAlertsChannelId,
            );
          } catch (err) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            throw err;
          } finally {
            span.end();
          }
        });
      }
    } catch (err) {
      this.logger.error(
        {
          err,
          messageId: payload.id,
          guildId: guildId,
          userId: payload.author.id,
        },
        "Failed to process message for automod spam detection",
      );
    }
  }
}
