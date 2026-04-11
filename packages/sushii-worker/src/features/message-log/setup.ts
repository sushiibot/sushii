import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { MessageCacheService } from "./application/MessageCacheService";
import { MessageDeleteAuditLogCache } from "./application/MessageDeleteAuditLogCache";
import { MessageLogService } from "./application/MessageLogService";
import { DrizzleMessageLogBlockRepository } from "./infrastructure/DrizzleMessageLogBlockRepository";
import { DrizzleMessageLogEventRepository } from "./infrastructure/DrizzleMessageLogEventRepository";
import { DeleteOldMessagesTask } from "./infrastructure/tasks/DeleteOldMessagesTask";
import { MessageDeleteAuditLogHandler } from "./presentation/events/MessageDeleteAuditLogHandler";
import { MessageLogRawHandler } from "./presentation/events/MessageLogRawHandler";

interface MessageLogServices {
  messageCacheService: MessageCacheService;
  messageLogService: MessageLogService;
}

export function setupMessageLog(
  client: Client,
  db: NodePgDatabase<typeof schema>,
  guildConfigRepository: GuildConfigRepository,
  emojiRepository: BotEmojiRepository,
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

  const auditLogCache = new MessageDeleteAuditLogCache();

  const messageLogService = new MessageLogService(
    client,
    messageLogEventRepository,
    messageLogBlockRepository,
    guildConfigRepository,
    emojiRepository,
    auditLogCache,
    logger.child({ component: "MessageLogService" }),
  );

  // Create event handlers
  const messageLogRawHandler = new MessageLogRawHandler(
    messageCacheService,
    messageLogService,
  );

  const messageDeleteAuditLogHandler = new MessageDeleteAuditLogHandler(
    auditLogCache,
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
    eventHandlers: [messageLogRawHandler, messageDeleteAuditLogHandler],
    tasks: [deleteOldMessagesTask],
    services: {
      messageCacheService,
      messageLogService,
    },
  };
}
