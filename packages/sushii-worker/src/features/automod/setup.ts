import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { DrizzleGuildConfigRepository } from "@/shared/infrastructure/DrizzleGuildConfigRepository";

import { SpamDetectionService } from "./application/SpamDetectionService";
import { AutomodMessageHandler } from "./presentation/events/AutomodMessageHandler";

export interface AutomodFeature {
  eventHandlers: AutomodMessageHandler[];
  services: {
    spamDetectionService: SpamDetectionService;
  };
}

export interface AutomodFeatureOptions {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
}

export function setupAutomodFeature(
  options: AutomodFeatureOptions,
): AutomodFeature {
  const { db, client, logger } = options;

  // Repositories
  const guildConfigRepository: GuildConfigRepository =
    new DrizzleGuildConfigRepository(
      db,
      logger.child({ component: "GuildConfigRepository" }),
    );

  // Services
  const spamDetectionService = new SpamDetectionService(
    logger.child({ component: "SpamDetectionService" }),
  );

  // Event handlers
  const automodMessageHandler = new AutomodMessageHandler(
    spamDetectionService,
    guildConfigRepository,
    client,
    logger.child({ component: "AutomodMessageHandler" }),
  );

  return {
    eventHandlers: [automodMessageHandler],
    services: {
      spamDetectionService,
    },
  };
}
