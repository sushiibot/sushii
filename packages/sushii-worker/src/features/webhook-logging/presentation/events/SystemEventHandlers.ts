import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

// Debug event handler - logs debug messages from Discord.js
export class DebugEventHandler extends EventHandler<Events.Debug> {
  readonly eventType = Events.Debug;

  constructor(private readonly logger: Logger) {
    super();
  }

  async handle(message: string): Promise<void> {
    this.logger.debug({ message }, "Discord client debug event");
  }
}

// Shard reconnecting handler - logs when a shard starts reconnecting
export class ShardReconnectingHandler extends EventHandler<Events.ShardReconnecting> {
  readonly eventType = Events.ShardReconnecting;

  constructor(private readonly logger: Logger) {
    super();
  }

  async handle(shardId: number): Promise<void> {
    this.logger.info({ shardId }, "Shard reconnecting");
  }
}

// Shard resume handler - logs when a shard resumes with replay count
export class ShardResumeHandler extends EventHandler<Events.ShardResume> {
  readonly eventType = Events.ShardResume;

  constructor(private readonly logger: Logger) {
    super();
  }

  async handle(shardId: number, replayedEvents: number): Promise<void> {
    this.logger.info({ shardId, replayedEvents }, "Shard resumed");
  }
}
