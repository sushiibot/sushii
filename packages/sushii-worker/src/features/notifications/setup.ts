import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { NotificationMessageService } from "./application/NotificationMessageService";
import { NotificationService } from "./application/NotificationService";
import { DrizzleNotificationBlockRepository } from "./infrastructure/DrizzleNotificationBlockRepository";
import { DrizzleNotificationRepository } from "./infrastructure/DrizzleNotificationRepository";
import { NotificationAutocomplete } from "./presentation/autocompletes/NotificationAutocomplete";
import { NotificationCommand } from "./presentation/commands/NotificationCommand";
import { NotificationMessageHandler } from "./presentation/events/NotificationMessageHandler";

interface NotificationDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function createNotificationServices({
  db,
  logger,
}: NotificationDependencies) {
  const notificationRepository = new DrizzleNotificationRepository(db);
  const notificationBlockRepository = new DrizzleNotificationBlockRepository(
    db,
  );

  const notificationService = new NotificationService(
    notificationRepository,
    notificationBlockRepository,
    logger.child({ module: "notificationService" }),
  );

  const notificationMessageService = new NotificationMessageService(
    notificationService,
    logger.child({ module: "notificationMessageService" }),
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
) {
  const { notificationMessageService, notificationService } = services;

  const eventHandlers = [
    new NotificationMessageHandler(
      notificationMessageService,
      notificationService,
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
  const services = createNotificationServices({ db, logger });
  const commands = createNotificationCommands(services, logger);
  const events = createNotificationEventHandlers(services, logger);

  return {
    services,
    commands: commands.commands,
    autocompletes: commands.autocompletes,
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: events.eventHandlers,
  };
}
