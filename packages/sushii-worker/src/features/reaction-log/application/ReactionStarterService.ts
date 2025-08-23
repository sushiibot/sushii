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

      // Check database
      const existing = await this.repository.getStarter(messageId, emoji);
      if (existing) {
        this.cacheStarter(key, existing);
        this.logger.trace(
          { key, existing },
          "Found reaction starter in database",
        );
        return { starterId: existing, isNew: false };
      }

      // Save as new starter
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

      // Check database
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
   */
  private cacheStarter(key: string, userId: string): void {
    // Simple FIFO eviction
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
        this.logger.trace({ evictedKey: firstKey }, "Evicted cache entry");
      }
    }
    this.cache.set(key, userId);
  }
}
