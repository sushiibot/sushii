import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithTasks } from "@/shared/types/FeatureSetup";

import { ReminderService } from "./application/ReminderService";
import {
  DrizzleReminderRepository,
  ReminderBackgroundTask,
} from "./infrastructure";
import { ReminderMetrics } from "./infrastructure/metrics/ReminderMetrics";
import { ReminderCommand } from "./presentation";

interface SetupRemindersFeatureDeps {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  deploymentService: DeploymentService;
  logger: Logger;
}

export function setupRemindersFeature(
  deps: SetupRemindersFeatureDeps,
): FeatureSetupWithTasks {
  const { db, client, deploymentService, logger } = deps;

  // Create infrastructure
  const reminderMetrics = new ReminderMetrics();
  const reminderRepository = new DrizzleReminderRepository(
    db,
    logger.child({ component: "DrizzleReminderRepository" }),
  );

  // Create application services
  const reminderService = new ReminderService(
    reminderRepository,
    client,
    logger.child({ component: "ReminderService" }),
  );

  // Create background task
  const reminderBackgroundTask = new ReminderBackgroundTask(
    client,
    deploymentService,
    logger.child({ component: "ReminderBackgroundTask" }),
    reminderService,
    reminderMetrics,
  );

  // Create presentation layer
  const reminderCommand = new ReminderCommand(
    reminderService,
    logger.child({ component: "ReminderCommand" }),
  );

  return {
    commands: [reminderCommand],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [],
    tasks: [reminderBackgroundTask],
  };
}
