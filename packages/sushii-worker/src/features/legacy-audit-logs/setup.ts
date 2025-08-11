import type { Logger } from "pino";

import type { BaseFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { LegacyAuditLogNotificationService } from "./application/LegacyAuditLogNotificationService";
import { LegacyAuditLogNotificationHandler } from "./presentation/events/LegacyAuditLogNotificationHandler";

interface LegacyAuditLogsDependencies {
  logger: Logger;
}

export function setupLegacyAuditLogsFeature({
  logger,
}: LegacyAuditLogsDependencies): BaseFeatureSetupReturn & {
  services: {
    notificationService: LegacyAuditLogNotificationService;
  };
} {
  const notificationService = new LegacyAuditLogNotificationService(
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
