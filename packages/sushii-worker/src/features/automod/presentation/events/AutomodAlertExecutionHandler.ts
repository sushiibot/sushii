import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import { Events, type Message, MessageType } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { AutomodAlertCache } from "../../application/AutomodAlertCache";
import type { InviteInfoService } from "../../application/InviteInfoService";
import { buildInviteInfoReply } from "../views/InviteInfoView";

const tracer = opentelemetry.trace.getTracer("automod");

/**
 * Listens for native Discord AutoMod alert messages (type 24) via messageCreate
 * and tracks them in the AutomodAlertCache so mods can see reactions when
 * actions are taken. Using messageCreate avoids the ManageGuild permission
 * requirement of the AutoModerationActionExecution gateway event.
 *
 * Also detects Discord invite links in the flagged content and replies with
 * server info for each invite found.
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
    private readonly inviteInfoService: InviteInfoService,
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

        // The AutoMod alert message is authored by the user who triggered the
        // rule — message.author.id is the target user.
        const targetUserId = message.author.id;

        span.setAttribute("user.id", targetUserId);

        this.cache.track(
          message.guildId,
          targetUserId,
          message.id,
          message.channelId,
        );

        span.setAttribute("tracked", true);

        this.logger.debug(
          {
            guildId: message.guildId,
            userId: targetUserId,
            messageId: message.id,
            channelId: message.channelId,
          },
          "Tracked native AutoMod alert message",
        );

        // Fire-and-forget: detect invite links and reply with server info
        if (message.content) {
          this.replyWithInviteInfo(message).catch((err: unknown) => {
            this.logger.warn(
              { err, messageId: message.id, guildId: message.guildId },
              "Failed to send invite info reply",
            );
          });
        }
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

  private async replyWithInviteInfo(message: Message): Promise<void> {
    const codes = this.inviteInfoService.extractInviteCodes(message.content);
    if (codes.length === 0) return;

    const allInvites = await this.inviteInfoService.fetchInviteInfos(codes);

    // Skip invites pointing back to this server — mods don't need info on their own server
    const invites = allInvites.filter((i) => i.guildId !== message.guildId);
    if (invites.length === 0) return;

    await message.reply(buildInviteInfoReply(invites));

    this.logger.debug(
      {
        messageId: message.id,
        guildId: message.guildId,
        inviteCodes: invites.map((i) => i.code),
      },
      "Replied to AutoMod alert with invite info",
    );
  }
}
