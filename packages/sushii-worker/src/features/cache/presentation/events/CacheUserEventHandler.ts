import { Events } from "discord.js";
import type { Message } from "discord.js";
import opentelemetry from "@opentelemetry/api";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { CacheService } from "../../application";

const tracer = opentelemetry.trace.getTracer("cache-user-handler");

export class CacheUserHandler extends EventHandler<Events.MessageCreate> {
  constructor(private readonly cacheService: CacheService) {
    super();
  }

  readonly eventType = Events.MessageCreate;

  async handle(msg: Message): Promise<void> {
    if (msg.author.bot) {
      return;
    }

    const span = tracer.startSpan("upsert cached user");

    try {
      await this.cacheService.cacheUser({
        id: BigInt(msg.author.id),
        name: msg.author.username,
        discriminator: parseInt(msg.author.discriminator, 10),
        avatarUrl: msg.author.displayAvatarURL(),
        lastChecked: new Date(),
      });
    } finally {
      span.end();
    }
  }
}