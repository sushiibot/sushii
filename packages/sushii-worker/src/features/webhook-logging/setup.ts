import type { Logger } from "pino";

import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { CriticalErrorService } from "./infrastructure/CriticalErrorService";
import { initializeCriticalErrorService } from "./infrastructure/criticalError";
import { WebhookService } from "./infrastructure/WebhookService";
import { BotLifecycleHandler } from "./presentation/events/BotLifecycleHandler";
import { GuildJoinHandler } from "./presentation/events/GuildJoinHandler";
import { GuildLeaveHandler } from "./presentation/events/GuildLeaveHandler";
import { ShardDisconnectHandler } from "./presentation/events/ShardDisconnectHandler";
import { ShardErrorHandler } from "./presentation/events/ShardErrorHandler";
import { ShardReadyHandler } from "./presentation/events/ShardReadyHandler";

interface WebhookLoggingDependencies {
  logger: Logger;
}

export function setupWebhookLoggingFeature({
  logger,
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
    new BotLifecycleHandler(webhookService),
    new ShardReadyHandler(webhookService),
    new ShardDisconnectHandler(webhookService),
    new ShardErrorHandler(webhookService),
    new GuildJoinHandler(webhookService),
    new GuildLeaveHandler(webhookService),
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