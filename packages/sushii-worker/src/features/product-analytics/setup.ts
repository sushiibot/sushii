import type { Client } from "discord.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import * as schema from "@/infrastructure/database/schema";

import { ProductAnalyticsService } from "./application/ProductAnalyticsService";
import { ProductRollupService } from "./application/ProductRollupService";
import { DrizzleProductAnalyticsRepository } from "./infrastructure/DrizzleProductAnalyticsRepository";
import { ProductRollupTask } from "./infrastructure/tasks/ProductRollupTask";

interface ProductAnalyticsDependencies {
  client: Client;
  databaseUrl: string;
  deploymentService: DeploymentService;
  logger: Logger;
  analyticsKey: string | undefined;
}

export function setupProductAnalyticsFeature({
  client,
  databaseUrl,
  deploymentService,
  logger,
  analyticsKey,
}: ProductAnalyticsDependencies) {
  // Its own small pool, so slow analytics can't take connections from commands.
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 60_000,
    query_timeout: 65_000,
    idle_in_transaction_session_timeout: 120_000,
  });
  pool.on("error", (err) => {
    logger.warn({ err }, "Product analytics pool error");
  });

  const repository = new DrizzleProductAnalyticsRepository(
    drizzle(pool, { schema }),
  );
  const service = new ProductAnalyticsService(repository, analyticsKey, logger);
  const rollupService = new ProductRollupService(repository, logger);

  return {
    services: { productEvents: service },
    tasks: [new ProductRollupTask(client, deploymentService, rollupService)],
  };
}
