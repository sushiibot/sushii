import type { Guild, GuildBan } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { BanCacheService } from "../../application";

/**
 * Event handler for guild ban add events.
 * Handles real-time ban additions to keep the cache synchronized.
 * Errors propagate to the event dispatcher, which logs them.
 */
export class BanAddEventHandler extends EventHandler<Events.GuildBanAdd> {
  constructor(private readonly banCacheService: BanCacheService) {
    super();
  }

  readonly eventType = Events.GuildBanAdd;

  async handle(ban: GuildBan): Promise<void> {
    await this.banCacheService.handleBanAdd(ban.guild.id, ban.user.id);
  }
}

/**
 * Event handler for guild ban remove events.
 * Handles real-time ban removals to keep the cache synchronized.
 * Errors propagate to the event dispatcher, which logs them.
 */
export class BanRemoveEventHandler extends EventHandler<Events.GuildBanRemove> {
  constructor(private readonly banCacheService: BanCacheService) {
    super();
  }

  readonly eventType = Events.GuildBanRemove;

  async handle(ban: GuildBan): Promise<void> {
    await this.banCacheService.handleBanRemove(ban.guild.id, ban.user.id);
  }
}

/**
 * Event handler for guild create events.
 * Handles initial ban synchronization when the bot joins a guild.
 * Errors propagate to the event dispatcher, which logs them.
 */
export class GuildJoinBanSyncHandler extends EventHandler<Events.GuildCreate> {
  constructor(private readonly banCacheService: BanCacheService) {
    super();
  }

  readonly eventType = Events.GuildCreate;

  async handle(guild: Guild): Promise<void> {
    await this.banCacheService.handleGuildJoin(guild);
  }
}
