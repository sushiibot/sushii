import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/infrastructure/database/schema";
import { CacheService } from "./application";
import { DrizzleCachedGuildRepository, DrizzleCachedUserRepository } from "./infrastructure";
import { 
  createCacheGuildCreateHandler, 
  createCacheGuildUpdateHandler,
  createCacheUserHandler 
} from "./presentation";

interface CacheFeatureDependencies {
  db: NodePgDatabase<typeof schema>;
}

export interface CacheFeature {
  cacheService: CacheService;
  handlers: {
    cacheGuildCreate: ReturnType<typeof createCacheGuildCreateHandler>;
    cacheGuildUpdate: ReturnType<typeof createCacheGuildUpdateHandler>;
    cacheUser: ReturnType<typeof createCacheUserHandler>;
  };
}

export function createCacheFeature(dependencies: CacheFeatureDependencies): CacheFeature {
  const guildRepository = new DrizzleCachedGuildRepository(dependencies.db);
  const userRepository = new DrizzleCachedUserRepository(dependencies.db);
  
  const cacheService = new CacheService(
    guildRepository,
    userRepository,
    {
      userBatchSize: 50,
      userFlushIntervalMs: 30000, // 30 seconds
    }
  );

  const handlers = {
    cacheGuildCreate: createCacheGuildCreateHandler(cacheService),
    cacheGuildUpdate: createCacheGuildUpdateHandler(cacheService),
    cacheUser: createCacheUserHandler(cacheService),
  };

  return {
    cacheService,
    handlers,
  };
}