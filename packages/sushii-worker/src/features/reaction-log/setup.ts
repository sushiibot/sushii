import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { ReactionBatchProcessor } from "./application/ReactionBatchProcessor";
import { ReactionLogService } from "./application/ReactionLogService";
import { ReactionStarterService } from "./application/ReactionStarterService";
import { DrizzleReactionStarterRepository } from "./infrastructure/DrizzleReactionStarterRepository";
import { ReactionStarterCleanupTask } from "./infrastructure/tasks/ReactionStarterCleanupTask";
import { ReactionAddHandler } from "./presentation/events/ReactionAddHandler";
import { ReactionRemoveHandler } from "./presentation/events/ReactionRemoveHandler";

interface ReactionLogServices {
  reactionStarterService: ReactionStarterService;
  reactionLogService: ReactionLogService;
  reactionBatchProcessor: ReactionBatchProcessor;
}

export function setupReactionLog(
  db: NodePgDatabase<typeof schema>,
  client: Client,
  guildConfigRepository: GuildConfigRepository,
  deploymentService: DeploymentService,
  logger: Logger,
): FullFeatureSetupReturn<ReactionLogServices> {
  // Create infrastructure services
  const reactionStarterRepository = new DrizzleReactionStarterRepository(
    db,
    logger,
  );

  // Create application services
  const starterService = new ReactionStarterService(
    reactionStarterRepository,
    logger,
  );
  const reactionLogService = new ReactionLogService(client, logger);
  const batchProcessor = new ReactionBatchProcessor(
    starterService,
    reactionLogService,
    guildConfigRepository,
    logger,
  );

  // Create event handlers
  const eventHandlers = [
    new ReactionAddHandler(batchProcessor, logger),
    new ReactionRemoveHandler(batchProcessor, logger),
  ];

  // Create background tasks
  const tasks = [
    new ReactionStarterCleanupTask(
      client,
      deploymentService,
      logger,
      reactionStarterRepository,
    ),
  ];

  logger.info("Reaction log feature setup completed");

  return {
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers,
    tasks,
    services: {
      reactionStarterService: starterService,
      reactionLogService,
      reactionBatchProcessor: batchProcessor,
    },
  };
}
