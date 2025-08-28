import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import logger from "@/shared/infrastructure/logger";

import type {
  CachedGuildRepository,
  CachedUserRepository,
  NewCachedGuild,
  NewCachedUser,
} from "../domain";

interface CacheServiceConfig {
  userBatchSize: number;
  userFlushIntervalMs: number;
}

export class CacheService {
  private userQueue: NewCachedUser[] = [];
  private flushTimer: Timer | null = null;

  constructor(
    private readonly guildRepository: CachedGuildRepository,
    private readonly userRepository: CachedUserRepository,
    private readonly config: CacheServiceConfig,
  ) {
    this.startFlushTimer();
  }

  async cacheGuild(guildData: NewCachedGuild): Promise<Result<void, string>> {
    const result = await this.guildRepository.upsert(guildData);
    if (result.err) {
      logger.error(
        { err: result.val, guildId: guildData.id },
        "Failed to cache guild",
      );
      return Err(result.val);
    }

    return Ok(void 0);
  }

  async cacheUser(userData: NewCachedUser): Promise<void> {
    this.userQueue.push(userData);

    if (this.userQueue.length >= this.config.userBatchSize) {
      await this.flushUserQueue();
    }
  }

  async shutdown(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.userQueue.length > 0) {
      await this.flushUserQueue();
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(async () => {
      if (this.userQueue.length > 0) {
        await this.flushUserQueue();
      }
    }, this.config.userFlushIntervalMs);
  }

  private async flushUserQueue(): Promise<void> {
    if (this.userQueue.length === 0) return;

    const batch = this.userQueue.splice(0);

    // Deduplicate by user ID, keeping the most recent entry
    const deduplicatedMap = new Map<bigint, NewCachedUser>();
    for (const user of batch) {
      deduplicatedMap.set(user.id, user);
    }
    const deduplicatedBatch = Array.from(deduplicatedMap.values());

    logger.trace(
      {
        originalCount: batch.length,
        deduplicatedCount: deduplicatedBatch.length,
      },
      "Flushing user cache batch",
    );

    const result = await this.userRepository.batchUpsert(deduplicatedBatch);
    if (result.err) {
      logger.error(
        { err: result.val, count: deduplicatedBatch.length },
        "Failed to flush user cache batch",
      );
      // Re-queue failed items for retry
      this.userQueue.unshift(...deduplicatedBatch);
    }
  }
}
