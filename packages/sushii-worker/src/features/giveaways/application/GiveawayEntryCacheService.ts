import type { Message } from "discord.js";
import type { Logger } from "pino";

import { GiveawayEntry } from "../domain/entities/GiveawayEntry";
import type { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";
import type { GiveawayRepository } from "../domain/repositories/GiveawayRepository";

interface GiveawayCacheEntry {
  users: Set<string>;
  message: Message<true>;
}

/**
 * Updates the giveaway message to display the given entry count. Provided by
 * the composition root so the application layer doesn't depend on
 * presentation-layer component builders.
 */
export type GiveawayEntryCountUpdater = (
  giveawayMessage: Message<true>,
  entryCount: number,
) => Promise<void>;

export interface GiveawayEntryCacheOptions {
  /** Flush after this long without new entries. */
  debounceMs: number;
  /** Flush at most this long after the first unflushed entry. */
  maxWaitMs: number;
}

const DEFAULT_OPTIONS: GiveawayEntryCacheOptions = {
  debounceMs: 5000,
  maxWaitMs: 10000,
};

export class GiveawayEntryCacheService {
  /** Entries waiting to be flushed. */
  private pendingEntries = new Map<string, GiveawayCacheEntry>();
  /** Entries currently being inserted by an in-progress flush. */
  private inFlightEntries = new Map<string, GiveawayCacheEntry>();

  private debounceTimer?: NodeJS.Timeout;
  private maxWaitTimer?: NodeJS.Timeout;
  private activeFlush?: Promise<void>;
  private flushRequestedDuringFlush = false;

  private readonly options: GiveawayEntryCacheOptions;

  constructor(
    private readonly giveawayEntryRepository: GiveawayEntryRepository,
    private readonly giveawayRepository: GiveawayRepository,
    private readonly updateEntryCount: GiveawayEntryCountUpdater,
    private readonly logger: Logger,
    options: Partial<GiveawayEntryCacheOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async addEntryToCache(
    giveawayId: string,
    userId: string,
    giveawayMessage: Message<true>,
  ): Promise<void> {
    let entries = this.pendingEntries.get(giveawayId);
    if (!entries) {
      entries = {
        users: new Set(),
        message: giveawayMessage,
      };
      this.pendingEntries.set(giveawayId, entries);
    }

    entries.users.add(userId);

    this.logger.debug({ giveawayId, userId }, "Added entry to cache");

    this.scheduleFlush();
  }

  isInCache(giveawayId: string, userId: string): boolean {
    return (
      (this.pendingEntries.get(giveawayId)?.users.has(userId) ?? false) ||
      (this.inFlightEntries.get(giveawayId)?.users.has(userId) ?? false)
    );
  }

  /**
   * Whether the giveaway has entries that aren't in the database yet.
   */
  hasUnflushedEntries(giveawayId: string): boolean {
    return (
      (this.pendingEntries.get(giveawayId)?.users.size ?? 0) > 0 ||
      (this.inFlightEntries.get(giveawayId)?.users.size ?? 0) > 0
    );
  }

  /**
   * Flush pending entries now. If a flush is already running, waits for it and
   * then flushes anything that arrived in the meantime.
   */
  async flush(): Promise<void> {
    this.clearTimers();

    if (this.activeFlush) {
      this.flushRequestedDuringFlush = true;
      await this.activeFlush;
      // The queued flush (if still needed) was started when the previous one
      // completed.
      if (this.activeFlush) {
        await this.activeFlush;
      }
      return;
    }

    this.activeFlush = this.flushCacheToDatabase().finally(() => {
      this.activeFlush = undefined;
      this.onFlushComplete();
    });

    await this.activeFlush;
  }

  private scheduleFlush(): void {
    // Debounce: restart on every entry
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      void this.flush();
    }, this.options.debounceMs);

    // Max wait: started by the first unflushed entry, never restarted, so a
    // steady stream of entries can't postpone the flush indefinitely.
    if (!this.maxWaitTimer) {
      this.maxWaitTimer = setTimeout(() => {
        void this.flush();
      }, this.options.maxWaitMs);
    }
  }

  private clearTimers(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = undefined;
    }
  }

  private onFlushComplete(): void {
    if (this.flushRequestedDuringFlush) {
      this.flushRequestedDuringFlush = false;
      void this.flush();
      return;
    }

    // Entries that arrived during the flush already scheduled timers. Entries
    // restored after a failed insert need a retry scheduled.
    if (this.pendingEntries.size > 0 && !this.debounceTimer) {
      this.scheduleFlush();
    }
  }

  private async flushCacheToDatabase(): Promise<void> {
    if (this.pendingEntries.size === 0) {
      return;
    }

    // Snapshot and swap so entries added during the insert go to a fresh map
    const snapshot = this.pendingEntries;
    this.pendingEntries = new Map();
    this.inFlightEntries = snapshot;

    const allEntries = Array.from(snapshot.entries()).flatMap(
      ([giveawayId, entry]) =>
        Array.from(entry.users).map((userId) =>
          GiveawayEntry.create(giveawayId, userId),
        ),
    );

    let inserted = false;
    try {
      const insertResult =
        await this.giveawayEntryRepository.createBatch(allEntries);

      if (insertResult.ok) {
        inserted = true;
        this.logger.debug(
          {
            cacheSize: allEntries.length,
            dbInsertedSize: insertResult.val,
          },
          "Flushed cached giveaway entries to database",
        );
      } else {
        this.logger.error(
          { err: insertResult.val, entryCount: allEntries.length },
          "Failed to flush giveaway entries to database",
        );
      }
    } catch (err) {
      this.logger.error(
        { err, entryCount: allEntries.length },
        "Failed to flush giveaway entries to database",
      );
    } finally {
      if (!inserted) {
        this.restoreEntries(snapshot);
      }

      this.inFlightEntries = new Map();
    }

    if (!inserted) {
      return;
    }

    // One message edit per giveaway per flush
    for (const [giveawayId, entry] of snapshot) {
      await this.updateGiveawayMessageEntryCount(giveawayId, entry.message);
    }
  }

  private restoreEntries(snapshot: Map<string, GiveawayCacheEntry>): void {
    for (const [giveawayId, entry] of snapshot) {
      const pending = this.pendingEntries.get(giveawayId);
      if (pending) {
        for (const userId of entry.users) {
          pending.users.add(userId);
        }
      } else {
        this.pendingEntries.set(giveawayId, entry);
      }
    }
  }

  private async updateGiveawayMessageEntryCount(
    giveawayId: string,
    giveawayMessage: Message<true>,
  ): Promise<void> {
    try {
      const giveawayResult = await this.giveawayRepository.findByGuildAndId(
        giveawayMessage.guildId,
        giveawayId,
      );

      if (!giveawayResult.ok) {
        this.logger.error(
          { err: giveawayResult.val, giveawayId },
          "Failed to get giveaway for entry count update",
        );
        return;
      }

      // Ended/expired giveaways are updated by GiveawayTask; don't revert them
      // back to the active state
      const giveaway = giveawayResult.val;
      if (!giveaway || giveaway.isEnded || giveaway.isExpired()) {
        return;
      }

      const countResult =
        await this.giveawayEntryRepository.countByGiveaway(giveawayId);

      if (!countResult.ok) {
        this.logger.error(
          { err: countResult.val, giveawayId },
          "Failed to get entry count for message update",
        );
        return;
      }

      await this.updateEntryCount(giveawayMessage, countResult.val);
    } catch (err) {
      this.logger.error(
        { err, giveawayId },
        "Failed to update giveaway message entry count",
      );
    }
  }
}
