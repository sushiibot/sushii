import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import Color from "@/utils/colors";

import type { WebhookService } from "../../infrastructure/WebhookService";

export class ShardErrorHandler extends EventHandler<Events.ShardError> {
  readonly eventType = Events.ShardError;

  constructor(private readonly webhookService: WebhookService) {
    super();
  }

  async handle(error: Error, shardId: number): Promise<void> {
    await this.webhookService.logInfo(
      `[${shardId}] Shard Error`,
      error.message,
      Color.Error,
    );
  }
}