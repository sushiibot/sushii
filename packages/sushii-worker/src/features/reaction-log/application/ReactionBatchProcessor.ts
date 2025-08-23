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
  private creatingBatches = new Set<string>(); // Track batches being created to prevent race conditions
  private readonly BATCH_WINDOW_MS = 30000; // 30 seconds

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
          event.emoji,
          event.userId,
          event.guildId,
        );
        event.isInitial = isNew || starterId === event.userId;
        this.logger.trace(
          {
            messageId: event.messageId,
            emoji: event.emoji,
            userId: event.userId,
            isInitial: event.isInitial,
          },
          "Processed reaction add",
        );
      } else if (event.type === "remove") {
        const starterId = await this.starterService.getStarter(
          event.messageId,
          event.emoji,
        );
        event.isInitial = starterId === event.userId;
        this.logger.trace(
          {
            messageId: event.messageId,
            emoji: event.emoji,
            userId: event.userId,
            isInitial: event.isInitial,
          },
          "Processed reaction remove",
        );
      }

      // Batch management - Only create timer for new batches
      if (
        !this.batches.has(messageKey) &&
        !this.creatingBatches.has(messageKey)
      ) {
        // Mark as being created to prevent race condition
        this.creatingBatches.add(messageKey);

        try {
          this.batches.set(messageKey, {
            messageId: event.messageId,
            channelId: event.channelId,
            guildId: event.guildId,
            actions: [],
            startTime: new Date(),
          });

          this.logger.debug({ messageKey }, "Created new reaction batch");

          // Only set timer for new batch
          this.timers.set(
            messageKey,
            setTimeout(() => {
              this.processBatch(messageKey);
            }, this.BATCH_WINDOW_MS),
          );
        } finally {
          // Remove from creating set once done
          this.creatingBatches.delete(messageKey);
        }
      }

      // Add event to existing or new batch (safely)
      const batch = this.batches.get(messageKey);
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
   * Get current statistics for monitoring
   */
  public getStats(): { activeBatches: number; activeTimers: number } {
    return {
      activeBatches: this.batches.size,
      activeTimers: this.timers.size,
    };
  }
}
