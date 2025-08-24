import type { Logger } from "pino";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import type { ReactionStarterRepository } from "../domain/repositories/ReactionStarterRepository";
import type {
  GuildReactionBatch,
  ReactionEvent,
} from "../domain/types/ReactionEvent";
import { BATCH_WINDOW_MS } from "../domain/types/ReactionEvent";
import type { ReactionLogService } from "./ReactionLogService";

export class ReactionBatchProcessor {
  private guildBatches = new Map<string, GuildReactionBatch>();
  private timers = new Map<string, NodeJS.Timeout>();
  private batchCreationPromises = new Map<
    string,
    Promise<GuildReactionBatch>
  >(); // Track in-progress batch creations
  private readonly MAX_BATCHES = 1000; // Memory leak prevention

  constructor(
    private readonly starterRepository: ReactionStarterRepository,
    private readonly reactionLogService: ReactionLogService,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Queue a reaction removal event for guild-wide batching
   * Only removal events are batched and logged (additions are ignored)
   */
  async queueReactionRemoval(event: ReactionEvent): Promise<void> {
    // Only process removal events
    if (event.type !== "remove") {
      return;
    }

    try {
      // Check if reaction logging is enabled for this guild
      const config = await this.guildConfigRepository.findByGuildId(
        event.guildId,
      );

      if (
        !config.loggingSettings.reactionLogEnabled ||
        !config.loggingSettings.reactionLogChannel
      ) {
        return;
      }

      // Get starter information for context (even if they didn't remove it)
      const starterId = await this.starterRepository.getStarter(
        event.messageId,
        event.emojiString,
      );
      event.isInitial = starterId === event.userId;

      this.logger.trace(
        {
          messageId: event.messageId,
          emoji: event.emojiString,
          userId: event.userId,
          starterId,
          isInitial: event.isInitial,
        },
        "Processing reaction removal",
      );

      // Get or create guild batch using Promise coordination to prevent race conditions
      const guildBatch = await this.getOrCreateGuildBatch(event.guildId);
      if (guildBatch) {
        // Add to the appropriate message's removal list
        const messageEvents = guildBatch.removals.get(event.messageId) ?? [];
        messageEvents.push(event);
        guildBatch.removals.set(event.messageId, messageEvents);

        const totalRemovals = Array.from(guildBatch.removals.values()).reduce(
          (sum, events) => sum + events.length,
          0,
        );

        this.logger.trace(
          {
            guildId: event.guildId,
            messageId: event.messageId,
            totalRemovals,
          },
          "Added removal to guild batch",
        );
      }
    } catch (err) {
      this.logger.error({ err, event }, "Failed to queue reaction removal");
    }
  }

  /**
   * Process a completed guild batch by sending it to the log service
   */
  private async processGuildBatch(guildId: string): Promise<void> {
    const guildBatch = this.guildBatches.get(guildId);
    if (!guildBatch || guildBatch.removals.size === 0) {
      this.logger.trace(
        { guildId },
        "No guild batch to process or empty batch",
      );
      this.cleanupGuild(guildId);
      return;
    }

    const totalRemovals = Array.from(guildBatch.removals.values()).reduce(
      (sum, events) => sum + events.length,
      0,
    );

    this.logger.trace(
      { guildId, messagesCount: guildBatch.removals.size, totalRemovals },
      "Processing guild reaction batch",
    );

    try {
      const config = await this.guildConfigRepository.findByGuildId(guildId);
      if (
        !config.loggingSettings.reactionLogEnabled ||
        !config.loggingSettings.reactionLogChannel
      ) {
        this.logger.debug(
          { guildId },
          "Reaction logging disabled during batch processing",
        );
        return;
      }

      // Convert guild batch to legacy format for the log service
      await this.reactionLogService.logGuildBatch(
        guildBatch,
        config.loggingSettings.reactionLogChannel,
      );
      this.logger.trace({ guildId }, "Successfully processed guild batch");
    } catch (err) {
      this.logger.error(
        { err, guildId },
        "Failed to process guild reaction batch",
      );
    } finally {
      // Always cleanup resources even if processing fails
      this.cleanupGuild(guildId);
    }
  }

  /**
   * Clean up guild batch and timer resources
   */
  private cleanupGuild(guildId: string): void {
    this.guildBatches.delete(guildId);

    const timer = this.timers.get(guildId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(guildId);
    }

    this.logger.trace({ guildId }, "Cleaned up guild batch resources");
  }

  /**
   * Get or create a guild batch with Promise coordination to prevent race conditions
   */
  private async getOrCreateGuildBatch(
    guildId: string,
  ): Promise<GuildReactionBatch | null> {
    // Check if guild batch already exists
    const existingBatch = this.guildBatches.get(guildId);
    if (existingBatch) {
      return existingBatch;
    }

    // Check if batch creation is already in progress
    const existingPromise = this.batchCreationPromises.get(guildId);
    if (existingPromise) {
      try {
        return await existingPromise;
      } catch (err) {
        this.logger.error(
          { err, guildId },
          "Failed to wait for guild batch creation",
        );
        return null;
      }
    }

    // Create new guild batch creation promise
    const creationPromise = this.createGuildBatchInternal(guildId);
    this.batchCreationPromises.set(guildId, creationPromise);

    try {
      const guildBatch = await creationPromise;
      return guildBatch;
    } catch (err) {
      this.logger.error({ err, guildId }, "Failed to create guild batch");
      return null;
    } finally {
      // Always clean up the creation promise
      this.batchCreationPromises.delete(guildId);
    }
  }

  /**
   * Internal guild batch creation with memory leak prevention
   */
  private async createGuildBatchInternal(
    guildId: string,
  ): Promise<GuildReactionBatch> {
    // Memory leak prevention: cleanup old batches if needed
    await this.cleanupStaleGuildBatchesIfNeeded();

    // Create new guild batch
    const guildBatch: GuildReactionBatch = {
      guildId,
      removals: new Map(),
      startTime: new Date(),
    };

    this.guildBatches.set(guildId, guildBatch);
    this.logger.trace({ guildId }, "Created new guild reaction batch");

    // Set timer for batch processing
    this.timers.set(
      guildId,
      setTimeout(() => {
        this.processGuildBatch(guildId);
      }, BATCH_WINDOW_MS),
    );

    return guildBatch;
  }

  /**
   * Clean up stale guild batches to prevent memory leaks
   */
  private async cleanupStaleGuildBatchesIfNeeded(): Promise<void> {
    if (this.guildBatches.size < this.MAX_BATCHES) {
      return; // No cleanup needed
    }

    const now = new Date();
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const staleGuildBatches: string[] = [];

    for (const [guildId, guildBatch] of this.guildBatches) {
      const age = now.getTime() - guildBatch.startTime.getTime();
      if (age > STALE_THRESHOLD_MS) {
        staleGuildBatches.push(guildId);
      }
    }

    // Clean up stale guild batches
    for (const guildId of staleGuildBatches) {
      this.logger.warn(
        {
          guildId,
          batchAge:
            now.getTime() -
            (this.guildBatches.get(guildId)?.startTime.getTime() || 0),
        },
        "Cleaning up stale guild batch to prevent memory leak",
      );
      this.cleanupGuild(guildId);
    }

    // If still over limit, clean up oldest guild batches
    if (this.guildBatches.size >= this.MAX_BATCHES) {
      const sortedGuildBatches = Array.from(this.guildBatches.entries()).sort(
        (a, b) => a[1].startTime.getTime() - b[1].startTime.getTime(),
      );

      const toCleanup = sortedGuildBatches.slice(
        0,
        this.guildBatches.size - this.MAX_BATCHES + 100,
      ); // Clean up extra
      for (const [guildId] of toCleanup) {
        this.logger.warn(
          { guildId },
          "Force cleaning guild batch due to memory limit",
        );
        this.cleanupGuild(guildId);
      }
    }
  }

  /**
   * Get current statistics for monitoring
   */
  public getStats(): {
    activeGuildBatches: number;
    activeTimers: number;
    pendingCreations: number;
  } {
    return {
      activeGuildBatches: this.guildBatches.size,
      activeTimers: this.timers.size,
      pendingCreations: this.batchCreationPromises.size,
    };
  }
}
