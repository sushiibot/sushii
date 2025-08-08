import { Events, Guild } from "discord.js";
import opentelemetry from "@opentelemetry/api";
import { EventHandlerFn } from "@/events/EventHandler";
import { CacheService } from "../../application";

const tracer = opentelemetry.trace.getTracer("cache-guild-handler");

export function createCacheGuildCreateHandler(cacheService: CacheService): EventHandlerFn<Events.GuildCreate> {
  return async (guild: Guild): Promise<void> => {
    const span = tracer.startSpan("guild create upsert");

    try {
      await cacheService.cacheGuild({
        id: BigInt(guild.id),
        name: guild.name,
        icon: guild.iconURL(),
        banner: guild.bannerURL(),
        splash: guild.splashURL(),
        features: guild.features,
      });
    } finally {
      span.end();
    }
  };
}

export function createCacheGuildUpdateHandler(cacheService: CacheService): EventHandlerFn<Events.GuildUpdate> {
  return async (oldGuild: Guild, newGuild: Guild): Promise<void> => {
    const span = tracer.startSpan("guild update upsert");

    try {
      await cacheService.cacheGuild({
        id: BigInt(newGuild.id),
        name: newGuild.name,
        icon: newGuild.iconURL(),
        banner: newGuild.bannerURL(),
        splash: newGuild.splashURL(),
        features: newGuild.features,
      });
    } finally {
      span.end();
    }
  };
}