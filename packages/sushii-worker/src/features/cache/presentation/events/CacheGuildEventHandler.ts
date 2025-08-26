import { Events } from "discord.js";
import type { Guild } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { CacheService } from "../../application";

export class CacheGuildCreateHandler extends EventHandler<Events.GuildCreate> {
  constructor(private readonly cacheService: CacheService) {
    super();
  }

  // Guild create via Discord.js is only emitted for NEW guilds, otherwise
  // guildAvailable for existing guilds
  readonly eventType = Events.GuildCreate;

  // Needs to run before deployment is active
  isExemptFromDeploymentCheck = true;

  async handle(guild: Guild): Promise<void> {
    await this.cacheService.cacheGuild({
      id: BigInt(guild.id),
      name: guild.name,
      icon: guild.iconURL(),
      banner: guild.bannerURL(),
      splash: guild.splashURL(),
      features: guild.features,
      memberCount: BigInt(guild.memberCount),
    });
  }
}

export class CacheGuildAvailableHandler extends EventHandler<Events.GuildAvailable> {
  constructor(private readonly cacheService: CacheService) {
    super();
  }

  // Guild create gateway event, but in Discord.js when it's a guild that the
  // bot is already in and has become available
  readonly eventType = Events.GuildAvailable;

  // Needs to run before deployment is active
  isExemptFromDeploymentCheck = true;

  async handle(guild: Guild): Promise<void> {
    await this.cacheService.cacheGuild({
      id: BigInt(guild.id),
      name: guild.name,
      icon: guild.iconURL(),
      banner: guild.bannerURL(),
      splash: guild.splashURL(),
      features: guild.features,
      memberCount: BigInt(guild.memberCount),
    });
  }
}

export class CacheGuildUpdateHandler extends EventHandler<Events.GuildUpdate> {
  constructor(private readonly cacheService: CacheService) {
    super();
  }

  readonly eventType = Events.GuildUpdate;

  async handle(_oldGuild: Guild, newGuild: Guild): Promise<void> {
    await this.cacheService.cacheGuild({
      id: BigInt(newGuild.id),
      name: newGuild.name,
      icon: newGuild.iconURL(),
      banner: newGuild.bannerURL(),
      splash: newGuild.splashURL(),
      features: newGuild.features,
      memberCount: BigInt(newGuild.memberCount),
    });
  }
}
