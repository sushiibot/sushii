import opentelemetry from "@opentelemetry/api";
import { Events } from "discord.js";
import type { Guild } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { CacheService } from "../../application";

const tracer = opentelemetry.trace.getTracer("cache-guild-handler");

export class CacheGuildCreateHandler extends EventHandler<Events.GuildCreate> {
  constructor(private readonly cacheService: CacheService) {
    super();
  }

  readonly eventType = Events.GuildCreate;

  async handle(guild: Guild): Promise<void> {
    const span = tracer.startSpan("guild create upsert");

    try {
      await this.cacheService.cacheGuild({
        id: BigInt(guild.id),
        name: guild.name,
        icon: guild.iconURL(),
        banner: guild.bannerURL(),
        splash: guild.splashURL(),
        features: guild.features,
        memberCount: BigInt(guild.memberCount),
      });
    } finally {
      span.end();
    }
  }
}

export class CacheGuildUpdateHandler extends EventHandler<Events.GuildUpdate> {
  constructor(private readonly cacheService: CacheService) {
    super();
  }

  readonly eventType = Events.GuildUpdate;

  async handle(_oldGuild: Guild, newGuild: Guild): Promise<void> {
    const span = tracer.startSpan("guild update upsert");

    try {
      await this.cacheService.cacheGuild({
        id: BigInt(newGuild.id),
        name: newGuild.name,
        icon: newGuild.iconURL(),
        banner: newGuild.bannerURL(),
        splash: newGuild.splashURL(),
        features: newGuild.features,
        memberCount: BigInt(newGuild.memberCount),
      });
    } finally {
      span.end();
    }
  }
}
