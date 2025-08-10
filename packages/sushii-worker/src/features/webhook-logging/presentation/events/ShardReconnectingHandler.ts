import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

export class ShardReconnectingHandler extends EventHandler<Events.ShardReconnecting> {
  readonly eventType = Events.ShardReconnecting;

  constructor(private readonly logger: Logger) {
    super();
  }

  async handle(shardId: number): Promise<void> {
    // Regular application logging (no webhook notification for reconnecting)
    this.logger.info(
      {
        shardId,
      },
      "Shard reconnecting",
    );
  }
}