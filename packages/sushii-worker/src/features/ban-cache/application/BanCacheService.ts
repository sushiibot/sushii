import { sleep } from "bun";
import type { Guild } from "discord.js";
import type { Logger } from "pino";

import { GuildBan } from "../domain/entities/GuildBan";
import type { BanRepository } from "../domain/repositories/BanRepository";

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
  async handleBanAdd(guildId: string, userId: string): Promise<void> {
    this.logger.debug({ guildId, userId }, "Adding ban to cache");

    const ban = GuildBan.fromData(guildId, userId);
    await this.banRepository.addBan(ban);

    this.logger.debug({ guildId, userId }, "Successfully added ban to cache");
  }

  /**
   * Handles when a user is unbanned from a guild.
   */
  async handleBanRemove(guildId: string, userId: string): Promise<void> {
    this.logger.debug({ guildId, userId }, "Removing ban from cache");

    await this.banRepository.removeBan(guildId, userId);

    this.logger.debug(
      { guildId, userId },
      "Successfully removed ban from cache",
    );
  }

  /**
   * Handles when bot joins a guild - syncs all bans.
   */
  async handleGuildJoin(guild: Guild): Promise<void> {
    this.logger.info(
      { guildId: guild.id, guildName: guild.name },
      "Syncing bans for newly joined guild",
    );

    // Clear existing bans first (in case of rejoin)
    await this.banRepository.clearGuildBans(guild.id);

    // Fetch and sync bans page by page for memory efficiency
    const totalBans = await this.syncGuildBans(guild);

    this.logger.info(
      { guildId: guild.id, guildName: guild.name, banCount: totalBans },
      "Successfully synced all bans for guild",
    );
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

        // Isolate per-page failures: continue with the next page instead of
        // failing the whole sync
        let added = false;
        try {
          await this.banRepository.addGuildBans(guild.id, userIds);
          added = true;
        } catch (err) {
          this.logger.warn(
            {
              err,
              guildId: guild.id,
              pageSize: userIds.length,
            },
            "Failed to add ban page to database, continuing with next page",
          );
        }

        if (added) {
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
