import type { GuildBan } from "../entities/GuildBan";

/**
 * Repository interface for guild ban operations.
 * Defines the contract for ban data persistence.
 */
export interface BanRepository {
  /**
   * Adds a ban to the cache.
   */
  addBan(ban: GuildBan): Promise<void>;

  /**
   * Removes a ban from the cache.
   */
  removeBan(guildId: string, userId: string): Promise<void>;

  /**
   * Clears all bans for a guild.
   */
  clearGuildBans(guildId: string): Promise<void>;

  /**
   * Adds multiple bans for a guild.
   */
  addGuildBans(guildId: string, userIds: string[]): Promise<void>;

  /**
   * Gets all bans for a user across all guilds.
   */
  getUserBans(userId: string): Promise<GuildBan[]>;
}
