import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";

// Application services
import { GiveawayService } from "./application/GiveawayService";
import { GiveawayEntryService } from "./application/GiveawayEntryService";
import { GiveawayEntryCacheService } from "./application/GiveawayEntryCacheService";
import { GiveawayEligibilityService } from "./application/GiveawayEligibilityService";
import { GiveawayDrawService } from "./application/GiveawayDrawService";

// Infrastructure
import { DrizzleGiveawayRepository } from "./infrastructure/DrizzleGiveawayRepository";
import { DrizzleGiveawayEntryRepository } from "./infrastructure/DrizzleGiveawayEntryRepository";

// Presentation
import { GiveawayCommand } from "./presentation/commands/GiveawayCommand";
import { GiveawayAutocomplete } from "./presentation/autocompletes/GiveawayAutocomplete";
import { GiveawayButtonHandler } from "./presentation/components/GiveawayButtonHandler";

interface GiveawayDependencies {
  db: NodePgDatabase<typeof schema>;
  userLevelRepository: UserLevelRepository;
  logger: Logger;
}

export function createGiveawayServices({
  db,
  userLevelRepository,
  logger,
}: GiveawayDependencies) {
  // Repositories
  const giveawayRepository = new DrizzleGiveawayRepository(
    db,
    logger.child({ module: "giveawayRepository" }),
  );

  const giveawayEntryRepository = new DrizzleGiveawayEntryRepository(
    db,
    logger.child({ module: "giveawayEntryRepository" }),
  );

  // Application services
  const giveawayService = new GiveawayService(
    giveawayRepository,
    logger.child({ module: "giveawayService" }),
  );

  const giveawayEntryService = new GiveawayEntryService(
    giveawayEntryRepository,
    logger.child({ module: "giveawayEntryService" }),
  );

  const giveawayEntryCacheService = new GiveawayEntryCacheService(
    giveawayEntryRepository,
    logger.child({ module: "giveawayEntryCacheService" }),
  );

  const giveawayEligibilityService = new GiveawayEligibilityService(
    userLevelRepository,
    logger.child({ module: "giveawayEligibilityService" }),
  );

  const giveawayDrawService = new GiveawayDrawService(
    giveawayEntryRepository,
    logger.child({ module: "giveawayDrawService" }),
  );

  return {
    // Repositories
    giveawayRepository,
    giveawayEntryRepository,

    // Services
    giveawayService,
    giveawayEntryService,
    giveawayEntryCacheService,
    giveawayEligibilityService,
    giveawayDrawService,
  };
}

export function createGiveawayCommands(
  services: ReturnType<typeof createGiveawayServices>,
  logger: Logger,
) {
  const {
    giveawayService,
    giveawayEntryService,
    giveawayEntryCacheService,
    giveawayEligibilityService,
    giveawayDrawService,
  } = services;

  const commands = [
    new GiveawayCommand(
      giveawayService,
      giveawayDrawService,
      logger.child({ module: "giveawayCommand" }),
    ),
  ];

  const autocompletes = [
    new GiveawayAutocomplete(
      giveawayService,
      logger.child({ module: "giveawayAutocomplete" }),
    ),
  ];

  const buttonHandlers = [
    new GiveawayButtonHandler(
      giveawayService,
      giveawayEntryService,
      giveawayEntryCacheService,
      giveawayEligibilityService,
      logger.child({ module: "giveawayButtonHandler" }),
    ),
  ];

  return {
    commands,
    autocompletes,
    buttonHandlers,
  };
}

export function createGiveawayEventHandlers(
  _services: ReturnType<typeof createGiveawayServices>,
  _logger: Logger,
) {
  // Giveaways feature doesn't have event handlers currently
  return {
    eventHandlers: [],
  };
}

export function setupGiveawayFeature({
  db,
  userLevelRepository,
  logger,
}: GiveawayDependencies) {
  const services = createGiveawayServices({ db, userLevelRepository, logger });
  const commands = createGiveawayCommands(services, logger);
  const events = createGiveawayEventHandlers(services, logger);

  return {
    services,
    ...commands,
    ...events,
  };
}