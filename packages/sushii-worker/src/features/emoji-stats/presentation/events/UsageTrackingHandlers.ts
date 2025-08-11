import type {
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  User,
} from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import type {
  EmojiStatsTrackingService,
  TrackUsageRequest,
} from "../../application";

const logger = newModuleLogger("UsageTrackingHandlers");

export class MessageEmojiTrackingHandler extends EventHandler<Events.MessageCreate> {
  eventType = Events.MessageCreate as const;

  constructor(private emojiStatsTrackingService: EmojiStatsTrackingService) {
    super();
  }

  async handle(message: Message): Promise<void> {
    if (!message.inGuild()) {
      return;
    }

    const stickerIds =
      message.stickers.size > 0
        ? Array.from(message.stickers.keys())
        : undefined;

    const request: TrackUsageRequest = {
      userId: message.author.id,
      guildId: message.guild.id,
      actionType: "message",
      messageContent: message.content,
      stickerIds,
    };

    await this.emojiStatsTrackingService.trackUsage(request);
  }
}

export class ReactionEmojiTrackingHandler extends EventHandler<Events.MessageReactionAdd> {
  eventType = Events.MessageReactionAdd as const;

  constructor(private emojiStatsTrackingService: EmojiStatsTrackingService) {
    super();
  }

  async handle(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
  ): Promise<void> {
    // Skip if DM message
    if (!reaction.message.inGuild()) {
      return;
    }

    // Skip if no emoji ID (unicode emoji)
    if (!reaction.emoji.id) {
      return;
    }

    const request: TrackUsageRequest = {
      userId: user.id,
      guildId: reaction.message.guild.id,
      actionType: "reaction",
      emojiIds: [reaction.emoji.id],
    };

    await this.emojiStatsTrackingService.trackUsage(request);
  }
}
