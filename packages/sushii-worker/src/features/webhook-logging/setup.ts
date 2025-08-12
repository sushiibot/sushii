import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { CriticalErrorService } from "./infrastructure/CriticalErrorService";
import { WebhookService } from "./infrastructure/WebhookService";
import { initializeCriticalErrorService } from "./infrastructure/criticalError";
import { BotLifecycleHandler } from "./presentation/events/BotLifecycleHandler";
import { GuildJoinHandler } from "./presentation/events/GuildJoinHandler";
import { GuildLeaveHandler } from "./presentation/events/GuildLeaveHandler";
import { ShardDisconnectHandler } from "./presentation/events/ShardDisconnectHandler";
import { ShardErrorHandler } from "./presentation/events/ShardErrorHandler";
import { ShardReadyHandler } from "./presentation/events/ShardReadyHandler";
import {
  DebugEventHandler,
  ShardReconnectingHandler,
  ShardResumeHandler,
} from "./presentation/events/SystemEventHandlers";

interface WebhookLoggingDependencies {
  logger: Logger;
  deploymentService: DeploymentService;
}

export function setupWebhookLoggingFeature({
  logger,
  deploymentService,
}: WebhookLoggingDependencies): BaseFeatureSetupReturn & {
  services: {
    webhookService: WebhookService;
    criticalErrorService: CriticalErrorService;
  };
} {
  const webhookService = new WebhookService(logger);
  const criticalErrorService = new CriticalErrorService(webhookService);

  // Initialize singleton service for critical error reporting in legacy code
  initializeCriticalErrorService();

  const eventHandlers = [
    new BotLifecycleHandler(webhookService, logger),
    new ShardReadyHandler(webhookService, logger),
    new ShardDisconnectHandler(webhookService, logger),
    new ShardErrorHandler(webhookService, logger),
    new ShardReconnectingHandler(logger),
    new ShardResumeHandler(logger),
    new GuildJoinHandler(webhookService, logger, deploymentService),
    new GuildLeaveHandler(webhookService, logger),
    new DebugEventHandler(logger),
  ];

  return {
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers,
    services: {
      webhookService,
      criticalErrorService,
    },
  };
}
