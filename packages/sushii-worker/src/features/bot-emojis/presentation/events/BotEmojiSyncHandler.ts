import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { BotEmojiSyncService } from "../../application/BotEmojiSyncService";

/**
 * Event handler that triggers emoji sync on bot ready.
 */
export class BotEmojiSyncHandler extends EventHandler<"ready"> {
  public readonly eventType = "ready" as const;

  constructor(
    private readonly syncService: BotEmojiSyncService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(): Promise<void> {
    try {
      await this.syncService.syncEmojis();
    } catch (error) {
      this.logger.error({ err: error }, "Failed to sync emojis on ready event");
    }
  }
}
