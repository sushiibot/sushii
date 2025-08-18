import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import type { WebhookService } from "../webhook-logging/infrastructure/WebhookService";
import { BotEmojiSyncService } from "./application/BotEmojiSyncService";
import { DrizzleBotEmojiRepository } from "./infrastructure/DrizzleBotEmojiRepository";
import { BotEmojiSyncHandler } from "./presentation/events/BotEmojiSyncHandler";

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

export function createBotEmojiEventHandlers(
  services: ReturnType<typeof createBotEmojiServices>,
  logger: Logger,
) {
  const syncHandler = new BotEmojiSyncHandler(
    services.syncService,
    logger.child({ module: "BotEmojiSyncHandler" }),
  );

  return {
    eventHandlers: [syncHandler],
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
  const events = createBotEmojiEventHandlers(services, logger);

  return {
    services, // Includes botEmojiRepository for other features
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: events.eventHandlers,
  };
}
