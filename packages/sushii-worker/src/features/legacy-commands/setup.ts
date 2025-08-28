import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import type { EventHandlers } from "@/shared/types/FeatureSetup";

import {
  LegacyCommandDetectionService,
  LegacyCommandNotificationService,
} from "./application";
import { DrizzleLegacyCommandNotificationRepository } from "./infrastructure";
import { LegacyCommandMetrics } from "./infrastructure/metrics/LegacyCommandMetrics";
import { LegacyCommandMessageHandler } from "./presentation";

export function setupLegacyCommandFeature(
  client: Client,
  db: NodePgDatabase<typeof schema>,
  guildConfigRepository: GuildConfigRepository,
  logger: Logger,
): { eventHandlers: EventHandlers } {
  const featureLogger = logger.child({ feature: "legacy-commands" });

  // Infrastructure
  const notificationRepository = new DrizzleLegacyCommandNotificationRepository(
    db,
    featureLogger,
  );
  const metrics = new LegacyCommandMetrics();

  // Application Services
  const detectionService = new LegacyCommandDetectionService(
    guildConfigRepository,
    db,
    featureLogger,
  );

  const notificationService = new LegacyCommandNotificationService(
    notificationRepository,
    featureLogger,
  );

  // Presentation
  const messageHandler = new LegacyCommandMessageHandler(
    client,
    detectionService,
    notificationService,
    metrics,
    featureLogger,
  );

  featureLogger.info("Legacy command feature initialized");

  return {
    eventHandlers: [messageHandler],
  };
}
