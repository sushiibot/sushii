import { Message } from "discord.js";
import { Logger } from "pino";

import { GiveawayEntry } from "../domain/entities/GiveawayEntry";
import { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";

interface GiveawayCacheEntry {
  users: string[];
  message: Message<true>;
}

export class GiveawayEntryCacheService {
  private readonly entryCache = new Map<string, GiveawayCacheEntry>();
  private insertTimer?: NodeJS.Timeout;

  constructor(
    private readonly giveawayEntryRepository: GiveawayEntryRepository,
    private readonly logger: Logger,
  ) {}

  async addEntryToCache(
    giveawayId: string,
    userId: string,
    giveawayMessage: Message<true>,
  ): Promise<void> {
    let entries = this.entryCache.get(giveawayId);
    if (!entries) {
      entries = {
        users: [],
        message: giveawayMessage,
      };
    }

    // Add user to cache
    entries.users.push(userId);
    this.entryCache.set(giveawayId, entries);

    this.logger.debug(
      { giveawayId, userId },
      "Added entry to cache & clearing timeout",
    );

    // Clear and restart the timer
    if (this.insertTimer) {
      clearTimeout(this.insertTimer);
    }

    // Bulk insert after 5 seconds of inactivity
    this.insertTimer = setTimeout(async () => {
      await this.flushCacheToDatabase();
    }, 5000);
  }

  isInCache(giveawayId: string, userId: string): boolean {
    const entries = this.entryCache.get(giveawayId);
    return entries?.users.includes(userId) ?? false;
  }

  private async flushCacheToDatabase(): Promise<void> {
    const uniqueGiveaways = Array.from(this.entryCache.values()).map(
      (entry) => entry.message,
    );

    const allEntries = Array.from(this.entryCache.entries()).flatMap(
      ([giveawayId, entry]) =>
        entry.users.map((userId) =>
          GiveawayEntry.create(giveawayId, userId),
        ),
    );

    this.entryCache.clear();

    try {
      const insertResult = await this.giveawayEntryRepository.createBatch(allEntries);

      this.logger.debug(
        {
          cacheSize: allEntries.length,
          dbInsertedSize: insertResult.ok ? insertResult.val : 0,
          cacheAfterSize: this.entryCache.size,
        },
        "Flushing cached entries to database and updating messages",
      );

      // Update all giveaway messages with new entry counts
      for (const giveaway of uniqueGiveaways) {
        await this.updateGiveawayMessageEntryCount(giveaway);
      }
    } catch (err) {
      this.logger.error({ err }, "Failed to flush cache to database");
    }
  }

  private async updateGiveawayMessageEntryCount(
    giveawayMessage: Message<true>,
  ): Promise<void> {
    try {
      // TODO: This should call a service to update the message components
      // For now, we'll keep the existing logic structure
      const countResult = await this.giveawayEntryRepository.countByGiveaway(
        giveawayMessage.id,
      );

      if (!countResult.ok) {
        this.logger.error(
          { giveawayId: giveawayMessage.id },
          "Failed to get entry count for message update",
        );
        return;
      }

      // TODO: Update components with new count
      // This will be handled by the presentation layer in the final implementation
    } catch (err) {
      this.logger.error(
        { err, giveawayId: giveawayMessage.id },
        "Failed to update giveaway message entry count",
      );
    }
  }
}