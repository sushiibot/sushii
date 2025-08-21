import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import { StatsService } from "./application/StatsService";
import { DrizzleStatsRepository } from "./infrastructure/DrizzleStatsRepository";
import { StatsMetrics } from "./infrastructure/metrics/StatsMetrics";
import { StatsTask } from "./infrastructure/tasks/StatsTask";

interface StatsDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

interface StatsTaskDependencies extends StatsDependencies {
  client: Client;
  deploymentService: DeploymentService;
}

export function createStatsServices({ db, logger }: StatsDependencies) {
  const statsRepository = new DrizzleStatsRepository(
    db,
    logger.child({ module: "statsRepository" }),
  );

  const statsService = new StatsService(
    statsRepository,
    logger.child({ module: "statsService" }),
  );

  return {
    statsRepository,
    statsService,
  };
}

export function createStatsTasks(
  services: ReturnType<typeof createStatsServices>,
  client: Client,
  deploymentService: DeploymentService,
  statsMetrics: StatsMetrics,
): AbstractBackgroundTask[] {
  const { statsService } = services;

  const tasks = [
    new StatsTask(client, deploymentService, statsService, statsMetrics),
  ];

  return tasks;
}

export function setupStatsFeature({
  db,
  logger,
  client,
  deploymentService,
}: StatsTaskDependencies) {
  const statsMetrics = new StatsMetrics();
  const services = createStatsServices({ db, logger });
  const tasks = createStatsTasks(
    services,
    client,
    deploymentService,
    statsMetrics,
  );

  return {
    services,
    tasks,
  };
}
