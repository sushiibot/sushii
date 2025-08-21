import type { Logger } from "pino";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { LegacyAuditLogNotificationService } from "./application/LegacyAuditLogNotificationService";
import { LegacyAuditLogNotificationHandler } from "./presentation/events/LegacyAuditLogNotificationHandler";

interface LegacyAuditLogsDependencies {
  guildConfigRepository: GuildConfigRepository;
  logger: Logger;
}

export function setupLegacyAuditLogsFeature({
  guildConfigRepository,
  logger,
}: LegacyAuditLogsDependencies): BaseFeatureSetupReturn & {
  services: {
    notificationService: LegacyAuditLogNotificationService;
  };
} {
  const notificationService = new LegacyAuditLogNotificationService(
    guildConfigRepository,
    logger.child({ module: "legacyAuditLogNotification" }),
  );

  const eventHandlers = [
    new LegacyAuditLogNotificationHandler(notificationService, logger),
  ];

  return {
    commands: [],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers,
    services: {
      notificationService,
    },
  };
}
