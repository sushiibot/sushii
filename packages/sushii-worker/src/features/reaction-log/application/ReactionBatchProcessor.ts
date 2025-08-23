import type { Logger } from "pino";

import type {
  ReactionBatch,
  ReactionEvent,
} from "../domain/types/ReactionEvent";
import type { ReactionLogService } from "./ReactionLogService";
import type { ReactionStarterService } from "./ReactionStarterService";

export class ReactionBatchProcessor {
  private batches = new Map<string, ReactionBatch>();
  private timers = new Map<string, NodeJS.Timeout>();
  private batchCreationPromises = new Map<string, Promise<ReactionBatch>>(); // Track in-progress batch creations
  private readonly BATCH_WINDOW_MS = 30000; // 30 seconds
  private readonly MAX_BATCHES = 1000; // Memory leak prevention

  constructor(
    private readonly starterService: ReactionStarterService,
    private readonly reactionLogService: ReactionLogService,
    private readonly logger: Logger,
  ) {}

  /**
   * Queue a reaction event for batching
   * Events are batched by messageId for 30 seconds
   */
  async queueReactionEvent(event: ReactionEvent): Promise<void> {
    const messageKey = event.messageId;

    try {
      // Determine if user started this reaction
      if (event.type === "add") {
        const { starterId, isNew } = await this.starterService.getOrSetStarter(
          event.messageId,
          event.emojiString,
          event.userId,
          event.guildId,
        );
        event.isInitial = isNew || starterId === event.userId;
        this.logger.trace(
          {
            messageId: event.messageId,
            emoji: event.emojiString,
            userId: event.userId,
            isInitial: event.isInitial,
          },
          "Processed reaction add",
        );
      } else if (event.type === "remove") {
        const starterId = await this.starterService.getStarter(
          event.messageId,
          event.emojiString,
        );
        event.isInitial = starterId === event.userId;
        this.logger.trace(
          {
            messageId: event.messageId,
            emoji: event.emojiString,
            userId: event.userId,
            isInitial: event.isInitial,
          },
          "Processed reaction remove",
        );
      }

      // Get or create batch using Promise coordination to prevent race conditions
      const batch = await this.getOrCreateBatch(messageKey, event);
      if (batch) {
        batch.actions.push(event);
        this.logger.trace(
          { messageKey, actionCount: batch.actions.length },
          "Added event to batch",
        );
      }
    } catch (err) {
      this.logger.error({ err, event }, "Failed to queue reaction event");
    }
  }

  /**
   * Process a completed batch by sending it to the log service
   */
  private async processBatch(messageKey: string): Promise<void> {
    const batch = this.batches.get(messageKey);
    if (!batch || batch.actions.length === 0) {
      this.logger.debug({ messageKey }, "No batch to process or empty batch");
      this.cleanup(messageKey);
      return;
    }

    this.logger.debug(
      { messageKey, actionCount: batch.actions.length },
      "Processing reaction batch",
    );

    try {
      await this.reactionLogService.logBatch(batch);
      this.logger.debug({ messageKey }, "Successfully processed batch");
    } catch (err) {
      this.logger.error({ err, batch }, "Failed to process reaction batch");
    } finally {
      // Always cleanup resources even if processing fails
      this.cleanup(messageKey);
    }
  }

  /**
   * Clean up batch and timer resources
   */
  private cleanup(messageKey: string): void {
    this.batches.delete(messageKey);

    const timer = this.timers.get(messageKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(messageKey);
    }

    this.logger.trace({ messageKey }, "Cleaned up batch resources");
  }

  /**
   * Get or create a batch with Promise coordination to prevent race conditions
   */
  private async getOrCreateBatch(
    messageKey: string,
    event: ReactionEvent,
  ): Promise<ReactionBatch | null> {
    // Check if batch already exists
    const existingBatch = this.batches.get(messageKey);
    if (existingBatch) {
      return existingBatch;
    }

    // Check if batch creation is already in progress
    const existingPromise = this.batchCreationPromises.get(messageKey);
    if (existingPromise) {
      try {
        return await existingPromise;
      } catch (err) {
        this.logger.error(
          { err, messageKey },
          "Failed to wait for batch creation",
        );
        return null;
      }
    }

    // Create new batch creation promise
    const creationPromise = this.createBatchInternal(messageKey, event);
    this.batchCreationPromises.set(messageKey, creationPromise);

    try {
      const batch = await creationPromise;
      return batch;
    } catch (err) {
      this.logger.error({ err, messageKey }, "Failed to create batch");
      return null;
    } finally {
      // Always clean up the creation promise
      this.batchCreationPromises.delete(messageKey);
    }
  }

  /**
   * Internal batch creation with memory leak prevention
   */
  private async createBatchInternal(
    messageKey: string,
    event: ReactionEvent,
  ): Promise<ReactionBatch> {
    // Memory leak prevention: cleanup old batches if needed
    await this.cleanupStalesBatchesIfNeeded();

    // Create new batch
    const batch: ReactionBatch = {
      messageId: event.messageId,
      channelId: event.channelId,
      guildId: event.guildId,
      actions: [],
      startTime: new Date(),
    };

    this.batches.set(messageKey, batch);
    this.logger.debug({ messageKey }, "Created new reaction batch");

    // Set timer for batch processing
    this.timers.set(
      messageKey,
      setTimeout(() => {
        this.processBatch(messageKey);
      }, this.BATCH_WINDOW_MS),
    );

    return batch;
  }

  /**
   * Clean up stale batches to prevent memory leaks
   */
  private async cleanupStalesBatchesIfNeeded(): Promise<void> {
    if (this.batches.size < this.MAX_BATCHES) {
      return; // No cleanup needed
    }

    const now = new Date();
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
    const staleBatches: string[] = [];

    for (const [messageKey, batch] of this.batches) {
      const age = now.getTime() - batch.startTime.getTime();
      if (age > STALE_THRESHOLD_MS) {
        staleBatches.push(messageKey);
      }
    }

    // Clean up stale batches
    for (const messageKey of staleBatches) {
      this.logger.warn(
        {
          messageKey,
          batchAge:
            now.getTime() -
            (this.batches.get(messageKey)?.startTime.getTime() || 0),
        },
        "Cleaning up stale batch to prevent memory leak",
      );
      this.cleanup(messageKey);
    }

    // If still over limit, clean up oldest batches
    if (this.batches.size >= this.MAX_BATCHES) {
      const sortedBatches = Array.from(this.batches.entries()).sort(
        (a, b) => a[1].startTime.getTime() - b[1].startTime.getTime(),
      );

      const toCleanup = sortedBatches.slice(
        0,
        this.batches.size - this.MAX_BATCHES + 100,
      ); // Clean up extra
      for (const [messageKey] of toCleanup) {
        this.logger.warn(
          { messageKey },
          "Force cleaning batch due to memory limit",
        );
        this.cleanup(messageKey);
      }
    }
  }

  /**
   * Get current statistics for monitoring
   */
  public getStats(): {
    activeBatches: number;
    activeTimers: number;
    pendingCreations: number;
  } {
    return {
      activeBatches: this.batches.size,
      activeTimers: this.timers.size,
      pendingCreations: this.batchCreationPromises.size,
    };
  }
}
