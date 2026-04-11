import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import { Events, type Message, MessageType } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { AutomodAlertCache } from "../../application/AutomodAlertCache";

const tracer = opentelemetry.trace.getTracer("automod");

/**
 * Listens for native Discord AutoMod alert messages (type 24) via messageCreate
 * and tracks them in the AutomodAlertCache so mods can see reactions when
 * actions are taken. Using messageCreate avoids the ManageGuild permission
 * requirement of the AutoModerationActionExecution gateway event.
 */
export class AutomodAlertExecutionHandler extends EventHandler<Events.MessageCreate> {
  readonly eventType = Events.MessageCreate;

  // Always track alerts regardless of which slot is active. The cache is
  // in-memory and slot-local, so if tracking were gated on the active slot,
  // a switchover between the AutoMod alert and the mod action audit log would
  // leave the incoming active slot with an empty cache and no reaction fires.
  readonly isExemptFromDeploymentCheck = true;

  constructor(
    private readonly cache: AutomodAlertCache,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(message: Message): Promise<void> {
    if (message.type !== MessageType.AutoModerationAction) {
      return;
    }

    await tracer.startActiveSpan("automod.alert.track", async (span) => {
      span.setAttributes({
        "guild.id": message.guildId ?? "",
        "message.id": message.id,
        "channel.id": message.channelId,
      });

      try {
        if (!message.guildId) {
          span.setAttribute("skipped", true);
          span.setAttribute("skip.reason", "no_guild_id");
          return;
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
          this.logger.debug(
            { messageId: message.id, channelId: message.channelId },
            "AutoMod alert message has no mentioned user, skipping",
          );
          span.setAttribute("skipped", true);
          span.setAttribute("skip.reason", "no_mentioned_user");
          return;
        }

        span.setAttribute("user.id", targetUser.id);

        this.cache.track(
          message.guildId,
          targetUser.id,
          message.id,
          message.channelId,
        );

        span.setAttribute("tracked", true);

        this.logger.debug(
          {
            guildId: message.guildId,
            userId: targetUser.id,
            messageId: message.id,
            channelId: message.channelId,
          },
          "Tracked native AutoMod alert message",
        );
      } catch (error) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
