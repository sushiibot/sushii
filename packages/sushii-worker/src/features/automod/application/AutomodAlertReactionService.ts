import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { Guild } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  getActionTypeBotEmoji,
  getActionTypeEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";

import type { AutomodAlertCache } from "./AutomodAlertCache";

const tracer = opentelemetry.trace.getTracer("automod");

/**
 * Reacts to recent native Discord AutoMod alert messages with the mod action emoji.
 * Called fire-and-forget from AuditLogService after a mod action is processed.
 */
export class AutomodAlertReactionService {
  constructor(
    private readonly cache: AutomodAlertCache,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly logger: Logger,
  ) {}

  async reactToRecentAlerts(
    guild: Guild,
    targetUserId: string,
    actionType: ActionType,
  ): Promise<void> {
    await tracer.startActiveSpan("automod.alert.react", async (span) => {
      span.setAttributes({
        "guild.id": guild.id,
        "user.id": targetUserId,
        "action.type": String(actionType),
      });

      try {
        const entries = this.cache.consumeRecent(guild.id, targetUserId);

        span.setAttribute("alert.entries.count", entries.length);

        if (entries.length === 0) {
          this.logger.debug(
            { guildId: guild.id, targetUserId, actionType },
            "No recent automod alert entries found for user, skipping reaction",
          );
          return;
        }

        // Prefer the bot's custom emoji, fall back to unicode
        const emojiName = getActionTypeBotEmoji(actionType);
        const botEmoji = await this.emojiRepository.getEmojiByName(emojiName);
        const emojiString = botEmoji
          ? `${botEmoji.name}:${botEmoji.id}`
          : getActionTypeEmoji(actionType);

        span.setAttribute("emoji", emojiString);

        await Promise.all(
          entries.map((entry) =>
            this.reactToMessage(guild, targetUserId, entry.channelId, entry.messageId, emojiString),
          ),
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

  private async reactToMessage(
    guild: Guild,
    targetUserId: string,
    channelId: string,
    messageId: string,
    emojiString: string,
  ): Promise<void> {
    return tracer.startActiveSpan("automod.alert.react.message", async (span) => {
      span.setAttributes({
        "guild.id": guild.id,
        "user.id": targetUserId,
        "message.id": messageId,
        "channel.id": channelId,
        "emoji": emojiString,
      });

      try {
        const channel = await guild.channels.fetch(channelId);
        if (!channel?.isTextBased()) {
          span.setAttribute("skipped", true);
          span.setAttribute("skip.reason", "not_text_channel");
          return;
        }
        const message = await channel.messages.fetch(messageId);
        await message.react(emojiString);
        this.logger.debug(
          { guildId: guild.id, targetUserId, messageId, emojiString },
          "Reacted to automod alert message",
        );
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        this.logger.warn(
          { err, messageId, channelId },
          "Failed to react to automod alert message",
        );
      } finally {
        span.end();
      }
    });
  }
}
