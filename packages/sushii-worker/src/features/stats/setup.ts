import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { AbstractBackgroundTask } from "@/tasks/AbstractBackgroundTask";

import { StatsService } from "./application/StatsService";
import { DrizzleStatsRepository } from "./infrastructure/DrizzleStatsRepository";
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
): AbstractBackgroundTask[] {
  const { statsService } = services;

  const tasks = [new StatsTask(client, deploymentService, statsService)];

  return tasks;
}

export function setupStatsFeature({
  db,
  logger,
  client,
  deploymentService,
}: StatsTaskDependencies) {
  const services = createStatsServices({ db, logger });
  const tasks = createStatsTasks(services, client, deploymentService);

  return {
    services,
    tasks,
  };
}
