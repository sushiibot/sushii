import type { GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { MessageCacheService } from "../../application/MessageCacheService";
import type { MessageLogService } from "../../application/MessageLogService";
import type {
  GuildMessageCreatePayload,
  GuildMessageDeleteBulkPayload,
  GuildMessageDeletePayload,
  GuildMessageUpdatePayload,
} from "../../domain/types/GuildMessagePayloads";

export class MessageLogRawHandler extends EventHandler<Events.Raw> {
  constructor(
    private readonly messageCacheService: MessageCacheService,
    private readonly messageLogService: MessageLogService,
  ) {
    super();
  }

  readonly eventType = Events.Raw;

  async handle(event: GatewayDispatchPayload): Promise<void> {
    switch (event.t) {
      case GatewayDispatchEvents.MessageCreate:
        // Ignore DMs
        if (!event.d.guild_id) {
          return;
        }
        await this.messageCacheService.handleRawMessageCreate(
          event.d as GuildMessageCreatePayload,
        );
        break;

      case GatewayDispatchEvents.MessageUpdate:
        // Ignore DMs
        if (!event.d.guild_id) {
          return;
        }
        // Log first to preserve old message, then cache the new update
        await this.messageLogService.handleRawMessageUpdate(
          event.d as GuildMessageUpdatePayload,
        );
        await this.messageCacheService.handleRawMessageUpdate(
          event.d as GuildMessageUpdatePayload,
        );
        break;

      case GatewayDispatchEvents.MessageDelete:
        // Ignore DMs
        if (!event.d.guild_id) {
          return;
        }
        await this.messageLogService.handleRawMessageDelete(
          event.d as GuildMessageDeletePayload,
        );
        break;

      case GatewayDispatchEvents.MessageDeleteBulk:
        // Ignore DMs
        if (!event.d.guild_id) {
          return;
        }
        await this.messageLogService.handleRawMessageDeleteBulk(
          event.d as GuildMessageDeleteBulkPayload,
        );
        break;
    }
  }
}
