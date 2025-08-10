import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { BanCacheService } from "./application";
import { DrizzleBanRepository } from "./infrastructure";
import {
  BanAddEventHandler,
  BanRemoveEventHandler,
  GuildJoinBanSyncHandler,
} from "./presentation";

interface BanCacheDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

/**
 * Creates and configures the ban cache feature services.
 */
export function createBanCacheServices({ db, logger }: BanCacheDependencies) {
  // Infrastructure layer
  const banRepository = new DrizzleBanRepository(
    db,
    logger.child({ module: "banRepository" }),
  );

  // Application layer
  const banCacheService = new BanCacheService(
    banRepository,
    logger.child({ module: "banCacheService" }),
  );

  return {
    banRepository,
    banCacheService,
  };
}

/**
 * Sets up the complete ban cache feature with standard structure.
 */
export function setupBanCacheFeature({
  db,
  logger,
}: BanCacheDependencies): FeatureSetupWithServices<
  ReturnType<typeof createBanCacheServices>
> {
  const services = createBanCacheServices({ db, logger });

  // Presentation layer
  const eventHandlers = [
    new BanAddEventHandler(
      services.banCacheService,
      logger.child({ module: "banAddHandler" }),
    ),
    new BanRemoveEventHandler(
      services.banCacheService,
      logger.child({ module: "banRemoveHandler" }),
    ),
    new GuildJoinBanSyncHandler(
      services.banCacheService,
      logger.child({ module: "guildJoinHandler" }),
    ),
  ];

  return {
    services,
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers,
  };
}

export type BanCacheFeature = ReturnType<typeof setupBanCacheFeature>;
