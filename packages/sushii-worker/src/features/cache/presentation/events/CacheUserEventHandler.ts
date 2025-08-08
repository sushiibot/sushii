import { Events, Message } from "discord.js";
import opentelemetry from "@opentelemetry/api";
import { EventHandlerFn } from "@/events/EventHandler";
import { CacheService } from "../../application";

const tracer = opentelemetry.trace.getTracer("cache-user-handler");

export function createCacheUserHandler(cacheService: CacheService): EventHandlerFn<Events.MessageCreate> {
  return async (msg: Message): Promise<void> => {
    if (msg.author.bot) {
      return;
    }

    const span = tracer.startSpan("upsert cached user");

    try {
      await cacheService.cacheUser({
        id: BigInt(msg.author.id),
        name: msg.author.username,
        discriminator: parseInt(msg.author.discriminator, 10),
        avatarUrl: msg.author.displayAvatarURL(),
        lastChecked: new Date(),
      });
    } finally {
      span.end();
    }
  };
}