import type { Guild } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import {
  getActionTypeBotEmoji,
  getActionTypeEmoji,
} from "@/features/moderation/shared/presentation/views/ActionTypeFormatter";

import type { AutomodAlertCache } from "./AutomodAlertCache";

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
    const entries = this.cache.consumeRecent(guild.id, targetUserId);
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

    await Promise.all(
      entries.map(async (entry) => {
        try {
          const channel = await guild.channels.fetch(entry.channelId);
          if (!channel?.isTextBased()) return;
          const message = await channel.messages.fetch(entry.messageId);
          await message.react(emojiString);
          this.logger.debug(
            { guildId: guild.id, targetUserId, messageId: entry.messageId, emojiString },
            "Reacted to automod alert message",
          );
        } catch (err) {
          this.logger.warn(
            { err, messageId: entry.messageId, channelId: entry.channelId },
            "Failed to react to automod alert message",
          );
        }
      }),
    );
  }
}
