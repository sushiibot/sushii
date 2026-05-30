import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { GatewayDispatchPayload } from "discord.js";
import {
  DiscordAPIError,
  Events,
  GatewayDispatchEvents,
  RESTJSONErrorCodes,
} from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { SpamActionService } from "../../application/SpamActionService";
import type { SpamDetectionService } from "../../application/SpamDetectionService";
import { SCAM_IMAGE_MAX_SIZE_BYTES, type ScamImageHashService } from "../../application/ScamImageHashService";
import { isImageAttachment, type SpamAttachment } from "../../utils/attachmentUtils";

const tracer = opentelemetry.trace.getTracer("automod");

const TEST_GUILD_ID = "167058919611564043";
const TEST_TRIGGER = "__automod_test__";
const MAX_IMAGE_ATTACHMENTS_PER_CHECK = 3;

export class AutomodMessageHandler extends EventHandler<Events.Raw> {
  private readonly inProgressImageChecks = new Set<string>();

  constructor(
    private readonly spamDetectionService: SpamDetectionService,
    private readonly spamActionService: SpamActionService,
    private readonly scamImageHashService: ScamImageHashService,
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
    const spamContent = contentPart || null;
    const attachmentPart = payload.attachments?.length
      ? payload.attachments
          .map((a) => a.filename)
          .sort()
          .join(",")
      : undefined;
    const spamKey = [contentPart, attachmentPart]
      .filter((s): s is string => Boolean(s))
      .join("|");

    // Ignore messages with no content and no attachments
    if (!spamKey) {
      return;
    }

    try {
      const guildConfig =
        await this.guildConfigRepository.findByGuildId(guildId);

      if (
        guildId === TEST_GUILD_ID &&
        payload.content?.trim() === TEST_TRIGGER
      ) {
        await this.spamActionService.executeSpamAction(
          guildId,
          payload.author.id,
          payload.author.username,
          new Map([[payload.channel_id, [payload.id]]]),
          spamContent,
          [],
          guildConfig.moderationSettings.automodAlertsChannelId,
        );
        return;
      }

      if (!guildConfig.moderationSettings.automodSpamEnabled) {
        return;
      }

      const exemptRoles = guildConfig.moderationSettings.automodExemptRoleIds;
      if (
        exemptRoles.length > 0 &&
        payload.member?.roles?.some((r) => exemptRoles.includes(r))
      ) {
        return;
      }

      const spamAttachments: SpamAttachment[] = (payload.attachments ?? []).map(
        (a) => ({
          filename: a.filename,
          url: a.proxy_url ?? a.url,
          contentType: a.content_type,
        }),
      );

      // Fire-and-forget scam image check — does not block the gateway handler
      const imageUrls = (payload.attachments ?? [])
        .filter(
          (a) =>
            isImageAttachment({
              filename: a.filename,
              contentType: a.content_type,
            }) && (a.size ?? Infinity) <= SCAM_IMAGE_MAX_SIZE_BYTES,
        )
        .slice(0, MAX_IMAGE_ATTACHMENTS_PER_CHECK)
        .map((a) => a.proxy_url ?? a.url);

      const userKey = `${guildId}:${payload.author.id}`;
      if (imageUrls.length > 0) {
        if (this.inProgressImageChecks.has(userKey)) {
          this.logger.debug(
            { guildId, userId: payload.author.id },
            "Scam image check already in progress for user, skipping",
          );
        } else {
          this.inProgressImageChecks.add(userKey);
          void this.checkScamImage(
            guildId,
            payload.author.id,
            payload.author.username,
            payload.channel_id,
            payload.id,
            imageUrls,
            spamAttachments,
            guildConfig.moderationSettings.automodAlertsChannelId,
          ).finally(() => this.inProgressImageChecks.delete(userKey));
        }
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
              spamContent,
              spamAttachments,
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

  private async checkScamImage(
    guildId: string,
    userId: string,
    username: string,
    channelId: string,
    messageId: string,
    imageUrls: string[],
    attachments: SpamAttachment[],
    alertsChannelId: string | null | undefined,
  ): Promise<void> {
    try {
      const match = await this.scamImageHashService.checkAttachments(
        imageUrls,
        guildId,
      );
      if (!match) {
        return;
      }

      const matchLabel = match.label ?? match.category;

      await this.spamActionService.executeScamImageAction(
        guildId,
        userId,
        username,
        channelId,
        messageId,
        attachments,
        alertsChannelId,
        matchLabel,
      );
    } catch (err) {
      // Silently ignore Unknown Message — already deleted before we could act
      if (
        err instanceof DiscordAPIError &&
        err.code === RESTJSONErrorCodes.UnknownMessage
      ) {
        return;
      }

      this.logger.error(
        { err, guildId, userId },
        "Failed to run scam image check",
      );
    }
  }
}
