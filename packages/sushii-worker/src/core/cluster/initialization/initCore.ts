import { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { DeploymentChanged } from "@/features/deployment/domain/events/DeploymentChanged";
import { PostgreSQLDeploymentRepository } from "@/features/deployment/infrastructure/PostgreSQLDeploymentRepository";
import { drizzleDb } from "@/infrastructure/database/db";
import { SimpleEventBus } from "@/shared/infrastructure/SimpleEventBus";
import { config } from "@/shared/infrastructure/config";
import logger from "@/shared/infrastructure/logger";

export async function initCore() {
  // This just returns the global existing database for now, until we fully
  // integrate the database into the core
  const db = drizzleDb;

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

  return {
    db,
    deploymentService,
    eventBus,
  };
}
