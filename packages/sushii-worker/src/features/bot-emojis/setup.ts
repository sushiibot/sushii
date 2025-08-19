import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import type { WebhookService } from "../webhook-logging/infrastructure/WebhookService";
import { BotEmojiSyncService } from "./application/BotEmojiSyncService";
import { DrizzleBotEmojiRepository } from "./infrastructure/DrizzleBotEmojiRepository";
interface BotEmojiDependencies {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
  webhookService: WebhookService;
}

export function createBotEmojiServices({
  db,
  client,
  logger,
  webhookService,
}: BotEmojiDependencies) {
  const botEmojiRepository = new DrizzleBotEmojiRepository(db);
  const syncService = new BotEmojiSyncService(
    client,
    botEmojiRepository,
    webhookService,
    logger.child({ module: "BotEmojiSyncService" }),
  );

  return {
    botEmojiRepository, // Exposed for other features to use
    syncService,
  };
}

export function setupBotEmojiFeature({
  db,
  client,
  logger,
  webhookService,
}: BotEmojiDependencies): FeatureSetupWithServices<
  ReturnType<typeof createBotEmojiServices>
> {
  const services = createBotEmojiServices({
    db,
    client,
    logger,
    webhookService,
  });

  return {
    services, // Includes botEmojiRepository for other features
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [], // No event handlers - emoji sync now runs independently
  };
}
