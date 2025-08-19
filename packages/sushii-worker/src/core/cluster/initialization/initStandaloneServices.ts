import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { BotEmojiSyncService } from "@/features/bot-emojis/application/BotEmojiSyncService";
import { DrizzleBotEmojiRepository } from "@/features/bot-emojis/infrastructure/DrizzleBotEmojiRepository";
import { WebhookService } from "@/features/webhook-logging/infrastructure/WebhookService";
import type * as schema from "@/infrastructure/database/schema";

/**
 * Initialize standalone services that don't have dependencies from other features.
 * These services run independently after bot login.
 */
export async function initStandaloneServices(
  db: NodePgDatabase<typeof schema>,
  client: Client,
  logger: Logger,
): Promise<void> {
  // Emoji sync - only runs on shard 0
  if (!client.cluster.shardList.includes(0)) {
    logger.debug("Skipping standalone services - not shard 0");
    return;
  }

  try {
    logger.info("Initializing standalone services");

    // Initialize bot emoji sync
    const webhookService = new WebhookService(logger);
    const botEmojiRepository = new DrizzleBotEmojiRepository(db);
    const syncService = new BotEmojiSyncService(
      client,
      botEmojiRepository,
      webhookService,
      logger.child({ module: "BotEmojiSyncService" }),
    );

    await syncService.syncEmojis();
    logger.info("Standalone services initialized successfully");
  } catch (error) {
    // Non-fatal error - log and continue
    logger.error({ err: error }, "Failed to initialize standalone services");
  }
}