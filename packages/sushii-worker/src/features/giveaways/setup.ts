import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";
import { Client } from "discord.js";

import * as schema from "@/infrastructure/database/schema";
import { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

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

// Tasks
import { GiveawayTask } from "./infrastructure/tasks/GiveawayTask";

interface GiveawayDependencies {
  db: NodePgDatabase<typeof schema>;
  userLevelRepository: UserLevelRepository;
  logger: Logger;
}

interface GiveawayTaskDependencies extends GiveawayDependencies {
  client: Client;
  deploymentService: DeploymentService;
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
    giveawayRepository,
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

export function createGiveawayTasks(
  services: ReturnType<typeof createGiveawayServices>,
  client: Client,
  deploymentService: DeploymentService,
) {
  const { giveawayService, giveawayDrawService, giveawayEntryService } = services;

  const tasks = [
    new GiveawayTask(
      client,
      deploymentService,
      giveawayService,
      giveawayDrawService,
      giveawayEntryService,
    ),
  ];

  return {
    tasks,
  };
}

export function setupGiveawayFeature({
  db,
  userLevelRepository,
  logger,
  client,
  deploymentService,
}: GiveawayTaskDependencies): FullFeatureSetupReturn<ReturnType<typeof createGiveawayServices>> {
  const services = createGiveawayServices({ db, userLevelRepository, logger });
  const commands = createGiveawayCommands(services, logger);
  const events = createGiveawayEventHandlers(services, logger);
  const tasks = createGiveawayTasks(services, client, deploymentService);

  return {
    services,
    commands: commands.commands,
    autocompletes: commands.autocompletes,
    contextMenuHandlers: [],
    buttonHandlers: commands.buttonHandlers,
    eventHandlers: events.eventHandlers,
    tasks: tasks.tasks,
  };
}