import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import type * as schema from "@/infrastructure/database/schema";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { GiveawayDrawService } from "./application/GiveawayDrawService";
import { GiveawayEligibilityService } from "./application/GiveawayEligibilityService";
import { GiveawayEndService } from "./application/GiveawayEndService";
import { GiveawayEntryCacheService } from "./application/GiveawayEntryCacheService";
import { GiveawayEntryService } from "./application/GiveawayEntryService";
// Application services
import { GiveawayService } from "./application/GiveawayService";
import { DrizzleGiveawayEntryRepository } from "./infrastructure/DrizzleGiveawayEntryRepository";
// Infrastructure
import { DrizzleGiveawayRepository } from "./infrastructure/DrizzleGiveawayRepository";
import { GiveawayMetrics } from "./infrastructure/metrics/GiveawayMetrics";
// Tasks
import { GiveawayTask } from "./infrastructure/tasks/GiveawayTask";
import { GiveawayAutocomplete } from "./presentation/autocompletes/GiveawayAutocomplete";
// Presentation
import { GiveawayCommand } from "./presentation/commands/GiveawayCommand";
import { GiveawayButtonHandler } from "./presentation/components/GiveawayButtonHandler";
import { buildGiveawayComponents } from "./presentation/views/GiveawayComponentBuilder";
import { buildGiveawayEmbed } from "./presentation/views/GiveawayEmbedBuilder";

interface GiveawayDependencies {
  db: NodePgDatabase<typeof schema>;
  userLevelRepository: UserLevelRepository;
  client: Client;
  logger: Logger;
}

interface GiveawayTaskDependencies extends GiveawayDependencies {
  deploymentService: DeploymentService;
}

export function createGiveawayServices({
  db,
  userLevelRepository,
  client,
  logger,
}: GiveawayDependencies) {
  // Repositories
  const giveawayRepository = new DrizzleGiveawayRepository(db);

  const giveawayEntryRepository = new DrizzleGiveawayEntryRepository(db);

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
    giveawayRepository,
    async (giveawayMessage, entryCount) => {
      await giveawayMessage.edit({
        components: buildGiveawayComponents(entryCount, false),
      });
    },
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

  const giveawayEndService = new GiveawayEndService(
    client,
    giveawayService,
    giveawayDrawService,
    giveawayEntryService,
    giveawayEntryCacheService,
    async (channel, giveaway, winnerIds, entryCount) => {
      await channel.messages.edit(giveaway.id, {
        embeds: [buildGiveawayEmbed(giveaway, winnerIds)],
        components: buildGiveawayComponents(entryCount, giveaway.isEnded),
      });
    },
    logger.child({ module: "giveawayEndService" }),
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
    giveawayEndService,
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
    giveawayEndService,
  } = services;

  const commands = [
    new GiveawayCommand(
      giveawayService,
      giveawayDrawService,
      giveawayEndService,
      logger.child({ module: "giveawayCommand" }),
    ),
  ];

  const autocompletes = [new GiveawayAutocomplete(giveawayService)];

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
  giveawayMetrics: GiveawayMetrics,
) {
  const { giveawayService, giveawayEndService } = services;

  const tasks = [
    new GiveawayTask(
      client,
      deploymentService,
      giveawayService,
      giveawayEndService,
      giveawayMetrics,
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
}: GiveawayTaskDependencies): FullFeatureSetupReturn<
  ReturnType<typeof createGiveawayServices>
> {
  const giveawayMetrics = new GiveawayMetrics();
  const services = createGiveawayServices({
    db,
    userLevelRepository,
    client,
    logger,
  });
  const commands = createGiveawayCommands(services, logger);
  const events = createGiveawayEventHandlers(services, logger);
  const tasks = createGiveawayTasks(
    services,
    client,
    deploymentService,
    giveawayMetrics,
  );

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
