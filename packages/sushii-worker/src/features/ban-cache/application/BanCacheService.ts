import { sleep } from "bun";
import { Guild } from "discord.js";
import { Logger } from "pino";
import { Err, Ok, Result } from "ts-results";

import { BanRepository } from "../domain/repositories/BanRepository";
import { GuildBan } from "../domain/entities/GuildBan";

/**
 * Application service for ban cache operations.
 * Orchestrates business logic for managing guild ban cache.
 */
export class BanCacheService {
  constructor(
    private readonly banRepository: BanRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Handles when a user is banned from a guild.
   */
  async handleBanAdd(
    guildId: string,
    userId: string,
  ): Promise<Result<void, string>> {
    this.logger.debug({ guildId, userId }, "Adding ban to cache");

    const ban = GuildBan.fromData(guildId, userId);
    const result = await this.banRepository.addBan(ban);

    if (result.err) {
      this.logger.error(
        { err: result.val, guildId, userId },
        "Failed to add ban to cache",
      );
      return result;
    }

    this.logger.debug({ guildId, userId }, "Successfully added ban to cache");

    return Ok.EMPTY;
  }

  /**
   * Handles when a user is unbanned from a guild.
   */
  async handleBanRemove(
    guildId: string,
    userId: string,
  ): Promise<Result<void, string>> {
    this.logger.debug({ guildId, userId }, "Removing ban from cache");

    const result = await this.banRepository.removeBan(guildId, userId);

    if (result.err) {
      this.logger.error(
        { err: result.val, guildId, userId },
        "Failed to remove ban from cache",
      );
      return result;
    }

    this.logger.debug(
      { guildId, userId },
      "Successfully removed ban from cache",
    );

    return Ok.EMPTY;
  }

  /**
   * Handles when bot joins a guild - syncs all bans.
   */
  async handleGuildJoin(guild: Guild): Promise<Result<void, string>> {
    this.logger.info(
      { guildId: guild.id, guildName: guild.name },
      "Syncing bans for newly joined guild",
    );

    try {
      // Clear existing bans first (in case of rejoin)
      const clearResult = await this.banRepository.clearGuildBans(guild.id);
      if (clearResult.err) {
        return clearResult;
      }

      // Fetch and sync bans page by page for memory efficiency
      const totalBans = await this.syncGuildBans(guild);

      this.logger.info(
        { guildId: guild.id, guildName: guild.name, banCount: totalBans },
        "Successfully synced all bans for guild",
      );

      return Ok.EMPTY;
    } catch (error) {
      const errorMessage = `Failed to sync bans for guild ${guild.id}: ${error}`;
      this.logger.error(
        { err: error, guildId: guild.id, guildName: guild.name },
        "Failed to sync bans for guild",
      );
      return Err(errorMessage);
    }
  }

  /**
   * Fetches and syncs guild bans page by page for memory efficiency.
   * Returns the total number of bans processed.
   */
  private async syncGuildBans(guild: Guild): Promise<number> {
    let totalBans = 0;
    let after: string | undefined;

    while (true) {
      let page;
      try {
        page = await guild.bans.fetch({
          limit: 1000,
          after,
          cache: false,
        });
      } catch (err) {
        this.logger.debug(
          {
            guildId: guild.id,
            guildName: guild.name,
            err,
          },
          "Failed to fetch server bans page",
        );

        // Return what we have processed so far if a page fails
        return totalBans;
      }

      if (page.size > 0) {
        // Convert page to user IDs and add to database
        const userIds = Array.from(page.keys());
        const addResult = await this.banRepository.addGuildBans(
          guild.id,
          userIds,
        );

        if (addResult.err) {
          this.logger.warn(
            {
              err: addResult.val,
              guildId: guild.id,
              pageSize: userIds.length,
            },
            "Failed to add ban page to database, continuing with next page",
          );
          // Continue with next page instead of failing entirely
        } else {
          totalBans += userIds.length;
          this.logger.debug(
            {
              guildId: guild.id,
              pageSize: userIds.length,
              totalBans,
            },
            "Added ban page to database",
          );
        }
      }

      if (page.size < 1000) {
        // Last page
        break;
      }

      // Get next page cursor
      after = page.lastKey();
      if (!after) {
        break;
      }

      // Rate limit protection
      await sleep(1000);
    }

    return totalBans;
  }
}
