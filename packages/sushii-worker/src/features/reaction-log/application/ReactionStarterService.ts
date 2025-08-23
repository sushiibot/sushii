import type { Logger } from "pino";

import type { ReactionStarterRepository } from "../domain/repositories/ReactionStarterRepository";

export class ReactionStarterService {
  private cache = new Map<string, string>();
  private readonly MAX_CACHE_SIZE = 1000;

  constructor(
    private readonly repository: ReactionStarterRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Get or set the starter for a reaction emoji on a message
   * Returns the starter user ID and whether this is a new reaction
   */
  async getOrSetStarter(
    messageId: string,
    emoji: string,
    userId: string,
    guildId: string,
  ): Promise<{ starterId: string; isNew: boolean }> {
    const key = `${messageId}-${emoji}`;

    try {
      // Check cache first
      const cached = this.cache.get(key);
      if (cached) {
        this.logger.trace({ key, cached }, "Found reaction starter in cache");
        return { starterId: cached, isNew: false };
      }

      const existing = await this.repository.getStarter(messageId, emoji);
      if (existing) {
        this.cacheStarter(key, existing);
        this.logger.trace(
          { key, existing },
          "Found reaction starter in database",
        );
        return { starterId: existing, isNew: false };
      }

      // Save as new starter with retry logic
      await this.repository.saveStarter(messageId, emoji, userId, guildId);
      this.cacheStarter(key, userId);
      this.logger.debug(
        { messageId, emoji, userId },
        "New reaction starter created",
      );
      return { starterId: userId, isNew: true };
    } catch (err) {
      this.logger.error(
        { err, messageId, emoji, userId, guildId },
        "Failed to get or set reaction starter",
      );
      // Fallback: treat as existing reaction with current user as starter
      // This prevents the reaction from being lost entirely
      return { starterId: userId, isNew: false };
    }
  }

  /**
   * Get the starter for a reaction emoji on a message (read-only)
   */
  async getStarter(messageId: string, emoji: string): Promise<string | null> {
    const key = `${messageId}-${emoji}`;

    try {
      // Check cache first
      const cached = this.cache.get(key);
      if (cached) {
        this.logger.trace({ key, cached }, "Found reaction starter in cache");
        return cached;
      }

      const existing = await this.repository.getStarter(messageId, emoji);
      if (existing) {
        this.cacheStarter(key, existing);
        this.logger.trace(
          { key, existing },
          "Found reaction starter in database",
        );
      }

      return existing;
    } catch (err) {
      this.logger.error(
        { err, messageId, emoji },
        "Failed to get reaction starter",
      );
      // Return null on error - reaction will not be marked as initial
      return null;
    }
  }

  /**
   * Cache a starter with FIFO eviction when cache is full
   * Uses atomic operations to prevent race conditions
   */
  private cacheStarter(key: string, userId: string): void {
    // Set the value first (atomic operation)
    this.cache.set(key, userId);

    // Then check if cleanup is needed and evict excess entries
    if (this.cache.size > this.MAX_CACHE_SIZE) {
      const toDelete = this.cache.size - this.MAX_CACHE_SIZE;
      const iter = this.cache.keys();

      for (let i = 0; i < toDelete; i++) {
        const keyToDelete = iter.next().value;
        if (keyToDelete && keyToDelete !== key) {
          // Don't delete the key we just added
          this.cache.delete(keyToDelete);
          this.logger.trace({ evictedKey: keyToDelete }, "Evicted cache entry");
        }
      }
    }
  }
}
