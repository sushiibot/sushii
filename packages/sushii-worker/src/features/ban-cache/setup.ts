import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";

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

  // Presentation layer
  const banAddHandler = new BanAddEventHandler(
    banCacheService,
    logger.child({ module: "banAddHandler" }),
  );
  const banRemoveHandler = new BanRemoveEventHandler(
    banCacheService,
    logger.child({ module: "banRemoveHandler" }),
  );
  const guildJoinHandler = new GuildJoinBanSyncHandler(
    banCacheService,
    logger.child({ module: "guildJoinHandler" }),
  );

  return {
    service: banCacheService,
    handlers: {
      banAdd: banAddHandler,
      banRemove: banRemoveHandler,
      guildJoin: guildJoinHandler,
    },
  };
}

export type BanCacheFeature = ReturnType<typeof createBanCacheServices>;
