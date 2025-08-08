import { Result } from "ts-results";
import { GuildBan } from "../entities";

/**
 * Repository interface for guild ban operations.
 * Defines the contract for ban data persistence.
 */
export interface BanRepository {
  /**
   * Adds a ban to the cache.
   */
  addBan(ban: GuildBan): Promise<Result<void, string>>;

  /**
   * Removes a ban from the cache.
   */
  removeBan(guildId: string, userId: string): Promise<Result<void, string>>;

  /**
   * Clears all bans for a guild.
   */
  clearGuildBans(guildId: string): Promise<Result<void, string>>;

  /**
   * Adds multiple bans for a guild.
   */
  addGuildBans(guildId: string, userIds: string[]): Promise<Result<void, string>>;

}