import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import Color from "@/utils/colors";

import type { WebhookService } from "../../infrastructure/WebhookService";

export class ShardReadyHandler extends EventHandler<Events.ShardReady> {
  readonly eventType = Events.ShardReady;

  constructor(
    private readonly webhookService: WebhookService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(shardId: number, unavailableGuilds: Set<string> | undefined): Promise<void> {
    // Regular application logging
    this.logger.info(
      {
        shardId,
        unavailableGuilds,
      },
      "Shard ready",
    );

    // Webhook notification
    const content = `unavailable guilds: \`${unavailableGuilds?.size || "none"}\``;
    await this.webhookService.logInfo(
      `[Shard #${shardId}] ShardReady`,
      content,
      Color.Success,
    );
  }
}