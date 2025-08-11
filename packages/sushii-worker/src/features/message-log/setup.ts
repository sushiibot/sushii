import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { MessageCacheService } from "./application/MessageCacheService";
import { MessageLogService } from "./application/MessageLogService";
import { DrizzleMessageLogBlockRepository } from "./infrastructure/DrizzleMessageLogBlockRepository";
import { DrizzleMessageLogEventRepository } from "./infrastructure/DrizzleMessageLogEventRepository";
import { DeleteOldMessagesTask } from "./infrastructure/tasks/DeleteOldMessagesTask";
import { MessageLogRawHandler } from "./presentation/events/MessageLogRawHandler";

interface MessageLogServices {
  messageCacheService: MessageCacheService;
  messageLogService: MessageLogService;
}

export function setupMessageLog(
  client: Client,
  db: NodePgDatabase<typeof schema>,
  guildConfigRepository: GuildConfigRepository,
  deploymentService: DeploymentService,
  logger: Logger,
): FullFeatureSetupReturn<MessageLogServices> {
  // Create repositories
  const messageLogEventRepository = new DrizzleMessageLogEventRepository(
    db,
    logger.child({ component: "MessageLogEventRepository" }),
  );

  const messageLogBlockRepository = new DrizzleMessageLogBlockRepository(
    db,
    logger.child({ component: "MessageLogBlockRepository" }),
  );

  // Create services
  const messageCacheService = new MessageCacheService(
    messageLogEventRepository,
    messageLogBlockRepository,
    guildConfigRepository,
    logger.child({ component: "MessageCacheService" }),
  );

  const messageLogService = new MessageLogService(
    client,
    messageLogEventRepository,
    messageLogBlockRepository,
    guildConfigRepository,
    logger.child({ component: "MessageLogService" }),
  );

  // Create raw handler
  const messageLogRawHandler = new MessageLogRawHandler(
    messageCacheService,
    messageLogService,
  );

  // Create tasks
  const deleteOldMessagesTask = new DeleteOldMessagesTask(
    client,
    deploymentService,
    messageLogEventRepository,
  );

  return {
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [messageLogRawHandler],
    tasks: [deleteOldMessagesTask],
    services: {
      messageCacheService,
      messageLogService,
    },
  };
}
