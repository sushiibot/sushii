import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type * as schema from "@/infrastructure/database/schema";
import type { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { NotificationMessageService } from "./application/NotificationMessageService";
import { NotificationService } from "./application/NotificationService";
import { DrizzleNotificationBlockRepository } from "./infrastructure/DrizzleNotificationBlockRepository";
import { DrizzleNotificationRepository } from "./infrastructure/DrizzleNotificationRepository";
import { DrizzleNotificationUserSettingsRepository } from "./infrastructure/DrizzleNotificationUserSettingsRepository";
import { NotificationMetrics } from "./infrastructure/metrics/NotificationMetrics";
import { NotificationAutocomplete } from "./presentation/autocompletes/NotificationAutocomplete";
import { NotificationCommand } from "./presentation/commands/NotificationCommand";
import { NotificationMessageHandler } from "./presentation/events/NotificationMessageHandler";

interface NotificationDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function createNotificationServices(
  { db, logger }: NotificationDependencies,
  notificationMetrics: NotificationMetrics,
) {
  const notificationRepository = new DrizzleNotificationRepository(db);
  const notificationBlockRepository = new DrizzleNotificationBlockRepository(
    db,
  );
  const notificationUserSettingsRepository =
    new DrizzleNotificationUserSettingsRepository(db);

  const notificationService = new NotificationService(
    notificationRepository,
    notificationBlockRepository,
    notificationUserSettingsRepository,
    logger.child({ module: "notificationService" }),
  );

  const notificationMessageService = new NotificationMessageService(
    notificationService,
    logger.child({ module: "notificationMessageService" }),
    notificationMetrics,
  );

  return {
    notificationRepository,
    notificationBlockRepository,
    notificationService,
    notificationMessageService,
  };
}

export function createNotificationCommands(
  services: ReturnType<typeof createNotificationServices>,
  _logger: Logger,
) {
  const { notificationService } = services;

  const commands = [new NotificationCommand(notificationService)];

  const autocompletes = [new NotificationAutocomplete(notificationService)];

  return {
    commands,
    autocompletes,
  };
}

export function createNotificationEventHandlers(
  services: ReturnType<typeof createNotificationServices>,
  _logger: Logger,
  notificationMetrics: NotificationMetrics,
) {
  const { notificationMessageService } = services;

  const eventHandlers = [
    new NotificationMessageHandler(
      notificationMessageService,
      notificationMetrics,
    ),
  ];

  return {
    eventHandlers,
  };
}

export function setupNotificationFeature({
  db,
  logger,
}: NotificationDependencies): FeatureSetupWithServices<
  ReturnType<typeof createNotificationServices>
> {
  // notificationMetrics is created first because createNotificationServices
  // requires it. The callback captures `services` which is assigned immediately
  // after, so it is always defined by the time the callback is invoked.
  let services: ReturnType<typeof createNotificationServices>;
  const notificationMetrics = new NotificationMetrics(() =>
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    services!.notificationService.getTotalNotificationCount(),
  );

  services = createNotificationServices({ db, logger }, notificationMetrics);
  const commands = createNotificationCommands(services, logger);
  const events = createNotificationEventHandlers(
    services,
    logger,
    notificationMetrics,
  );

  return {
    services,
    commands: commands.commands,
    autocompletes: commands.autocompletes,
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: events.eventHandlers,
  };
}
