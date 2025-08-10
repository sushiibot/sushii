import type { CloseEvent } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import Color from "@/utils/colors";

import type { WebhookService } from "../../infrastructure/WebhookService";

export class ShardDisconnectHandler extends EventHandler<Events.ShardDisconnect> {
  readonly eventType = Events.ShardDisconnect;

  constructor(private readonly webhookService: WebhookService) {
    super();
  }

  async handle(closeEvent: CloseEvent, shardId: number): Promise<void> {
    await this.webhookService.logInfo(
      `[${shardId}] Shard Disconnected`,
      "",
      Color.Warning,
    );
  }
}