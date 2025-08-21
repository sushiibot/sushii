import type { Client } from "discord.js";

import { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { DeploymentChanged } from "@/features/deployment/domain/events/DeploymentChanged";
import { PostgreSQLDeploymentRepository } from "@/features/deployment/infrastructure/PostgreSQLDeploymentRepository";
import { initDatabase } from "@/infrastructure/database/db";
import { SimpleEventBus } from "@/shared/infrastructure/SimpleEventBus";
import { config } from "@/shared/infrastructure/config";
import logger from "@/shared/infrastructure/logger";
import { CoreMetrics } from "@/shared/infrastructure/metrics/CoreMetrics";
import { InteractionMetrics } from "@/shared/infrastructure/metrics/InteractionMetrics";

import InteractionRouter from "../discord/InteractionRouter";

export async function initCore(client: Client) {
  // This just returns the global existing database for now, until we fully
  // integrate the database into the core
  const db = initDatabase(config.database.url, 3);

  // Create shared infrastructure
  const eventBus = new SimpleEventBus();

  // Initialize deployment service with direct database connection
  const deploymentRepository = new PostgreSQLDeploymentRepository(
    config.database.url,
    logger,
    eventBus,
    `sushii-deployment-${config.deployment.name}-shard-${process.env.SHARD_ID || "unknown"}`,
  );

  const deploymentService = new DeploymentService(
    deploymentRepository,
    logger,
    config.deployment.name,
    config.deployment,
  );

  // Subscribe to deployment changes
  eventBus.subscribe(DeploymentChanged, (event) => {
    deploymentService.handleDeploymentChanged(event);
  });

  await deploymentService.start();

  // Initialize metrics
  const coreMetrics = new CoreMetrics();
  const interactionMetrics = new InteractionMetrics();

  // Initialize interaction router
  const interactionRouter = new InteractionRouter(
    client,
    deploymentService,
    interactionMetrics,
  );

  return {
    db,
    deploymentService,
    eventBus,
    interactionRouter,
    coreMetrics,
  };
}
