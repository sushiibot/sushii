import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

export class ShardResumeHandler extends EventHandler<Events.ShardResume> {
  readonly eventType = Events.ShardResume;

  constructor(private readonly logger: Logger) {
    super();
  }

  async handle(shardId: number, replayedEvents: number): Promise<void> {
    // Regular application logging (no webhook notification for resume)
    this.logger.info(
      {
        shardId,
        replayedEvents,
      },
      "Shard resumed",
    );
  }
}