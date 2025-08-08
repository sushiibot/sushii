import type { Guild, GuildBan } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { BanCacheService } from "../../application";

/**
 * Event handler for guild ban add events.
 * Handles real-time ban additions to keep the cache synchronized.
 */
export class BanAddEventHandler extends EventHandler<Events.GuildBanAdd> {
  constructor(
    private readonly banCacheService: BanCacheService,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.GuildBanAdd;

  async handle(ban: GuildBan): Promise<void> {
    try {
      const result = await this.banCacheService.handleBanAdd(
        ban.guild.id,
        ban.user.id,
      );

      if (result.err) {
        this.logger.error(
          { err: result.val, guildId: ban.guild.id, userId: ban.user.id },
          "Failed to handle ban add event",
        );
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: ban.guild.id,
          userId: ban.user.id,
        },
        "Unexpected error in ban add event handler",
      );
    }
  }
}

/**
 * Event handler for guild ban remove events.
 * Handles real-time ban removals to keep the cache synchronized.
 */
export class BanRemoveEventHandler extends EventHandler<Events.GuildBanRemove> {
  constructor(
    private readonly banCacheService: BanCacheService,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.GuildBanRemove;

  async handle(ban: GuildBan): Promise<void> {
    try {
      const result = await this.banCacheService.handleBanRemove(
        ban.guild.id,
        ban.user.id,
      );

      if (result.err) {
        this.logger.error(
          { err: result.val, guildId: ban.guild.id, userId: ban.user.id },
          "Failed to handle ban remove event",
        );
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: ban.guild.id,
          userId: ban.user.id,
        },
        "Unexpected error in ban remove event handler",
      );
    }
  }
}

/**
 * Event handler for guild create events.
 * Handles initial ban synchronization when the bot joins a guild.
 */
export class GuildJoinBanSyncHandler extends EventHandler<Events.GuildCreate> {
  constructor(
    private readonly banCacheService: BanCacheService,
    private readonly logger: Logger,
  ) {
    super();
  }

  readonly eventType = Events.GuildCreate;

  async handle(guild: Guild): Promise<void> {
    try {
      const result = await this.banCacheService.handleGuildJoin(guild);

      if (result.err) {
        this.logger.error(
          { err: result.val, guildId: guild.id, guildName: guild.name },
          "Failed to handle guild join ban sync",
        );
      }
    } catch (error) {
      this.logger.error(
        {
          err: error,
          guildId: guild.id,
          guildName: guild.name,
        },
        "Unexpected error in guild join ban sync handler",
      );
    }
  }
}
