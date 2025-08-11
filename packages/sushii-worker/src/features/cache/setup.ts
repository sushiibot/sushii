import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";

import { CacheService } from "./application";
import {
  DrizzleCachedGuildRepository,
  DrizzleCachedUserRepository,
} from "./infrastructure";
import {
  CacheGuildCreateHandler,
  CacheGuildUpdateHandler,
  CacheUserHandler,
} from "./presentation";

interface CacheFeatureDependencies {
  db: NodePgDatabase<typeof schema>;
}

export interface CacheFeature {
  cacheService: CacheService;
  eventHandlers: [
    CacheGuildCreateHandler,
    CacheGuildUpdateHandler,
    CacheUserHandler,
  ];
}

export function createCacheFeature(
  dependencies: CacheFeatureDependencies,
): CacheFeature {
  const guildRepository = new DrizzleCachedGuildRepository(dependencies.db);
  const userRepository = new DrizzleCachedUserRepository(dependencies.db);

  const cacheService = new CacheService(guildRepository, userRepository, {
    userBatchSize: 50,
    userFlushIntervalMs: 30000, // 30 seconds
  });

  const eventHandlers: [
    CacheGuildCreateHandler,
    CacheGuildUpdateHandler,
    CacheUserHandler,
  ] = [
    new CacheGuildCreateHandler(cacheService),
    new CacheGuildUpdateHandler(cacheService),
    new CacheUserHandler(cacheService),
  ];

  return {
    cacheService,
    eventHandlers,
  };
}
