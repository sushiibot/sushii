import type { Logger } from "pino";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageLogBlockRepository } from "../domain/repositories/MessageLogBlockRepository";
import type { MessageLogEventRepository } from "../domain/repositories/MessageLogEventRepository";
import type {
  GuildMessageCreatePayload,
  GuildMessageUpdatePayload,
} from "../domain/types/GuildMessagePayloads";

export class MessageCacheService {
  constructor(
    private readonly messageLogEventRepository: MessageLogEventRepository,
    private readonly messageLogBlockRepository: MessageLogBlockRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  async handleRawMessageCreate(
    payload: GuildMessageCreatePayload,
  ): Promise<void> {
    await this.handleRawMessage(payload);
  }

  async handleRawMessageUpdate(
    payload: GuildMessageUpdatePayload,
  ): Promise<void> {
    await this.handleRawMessage(payload);
  }

  private async handleRawMessage(
    payload: GuildMessageCreatePayload | GuildMessageUpdatePayload,
  ): Promise<void> {
    // Ignore bots
    if (payload.author.bot) {
      return;
    }

    // Check if guild has message logging enabled
    const guildConfig = await this.guildConfigRepository.findByGuildId(
      payload.guild_id,
    );

    if (
      !guildConfig.loggingSettings.messageLogChannel ||
      !guildConfig.loggingSettings.messageLogEnabled
    ) {
      return;
    }

    // Check if channel is blocked
    const channelBlock =
      await this.messageLogBlockRepository.findByGuildAndChannel(
        payload.guild_id,
        payload.channel_id,
      );

    if (channelBlock) {
      return;
    }

    const messageLogEvent = MessageLogEvent.fromRawMessageCreate(payload);

    await this.messageLogEventRepository.save(messageLogEvent);

    this.logger.debug(
      {
        messageId: payload.id,
        guildId: payload.guild_id,
        channelId: payload.channel_id,
      },
      "Cached message for logging",
    );
  }
}
