import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { FeatureSetupWithServices } from "@/shared/types/FeatureSetup";

import { GetLeaderboardService } from "./application/GetLeaderboardService";
import { GetUserRankService } from "./application/GetUserRankService";
import { LevelRoleService } from "./application/LevelRoleService";
import { UpdateUserXpService } from "./application/UpdateUserXpService";
import { LevelRoleRepositoryImpl } from "./infrastructure/LevelRoleRepositoryImpl";
import { UserLevelRepository } from "./infrastructure/UserLevelRepository";
import { UserProfileRepository } from "./infrastructure/UserProfileRepository";
import { XpBlockRepositoryImpl } from "./infrastructure/XpBlockRepositoryImpl";
import LeaderboardCommand from "./presentation/commands/LeaderboardCommand";
import LevelRoleCommand from "./presentation/commands/LevelRoleCommand";
import { MessageLevelHandler } from "./presentation/events/MessageLevelHandler";
import RankCommand from "./presentation/commands/RankCommand";

interface LevelingDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
}

export function createLevelingServices({ db, logger }: LevelingDependencies) {
  const userProfileRepository = new UserProfileRepository(db);
  const userLevelRepository = new UserLevelRepository(db);
  const levelRoleRepository = new LevelRoleRepositoryImpl(db);
  const xpBlockRepository = new XpBlockRepositoryImpl(db);

  const getUserRankService = new GetUserRankService(
    userProfileRepository,
    userLevelRepository,
  );

  const getLeaderboardService = new GetLeaderboardService(userLevelRepository);

  const updateUserXpService = new UpdateUserXpService(
    userLevelRepository,
    levelRoleRepository,
    xpBlockRepository,
  );

  const levelRoleService = new LevelRoleService(levelRoleRepository);

  return {
    userProfileRepository,
    userLevelRepository,
    levelRoleRepository,
    xpBlockRepository,
    getUserRankService,
    getLeaderboardService,
    updateUserXpService,
    levelRoleService,
  };
}

export function createLevelingCommands(
  services: ReturnType<typeof createLevelingServices>,
  logger: Logger,
) {
  const { getUserRankService, getLeaderboardService, levelRoleService } = services;

  const commands = [
    new RankCommand(getUserRankService, logger.child({ module: "rank" })),
    new LeaderboardCommand(getLeaderboardService),
    new LevelRoleCommand(levelRoleService),
  ];

  return {
    commands,
    autocompletes: [],
  };
}

export function createLevelingEventHandlers(
  services: ReturnType<typeof createLevelingServices>,
  logger: Logger,
) {
  const { updateUserXpService } = services;

  const eventHandlers = [new MessageLevelHandler(updateUserXpService)];

  return {
    eventHandlers,
  };
}

export function setupLevelingFeature({
  db,
  logger,
}: LevelingDependencies): FeatureSetupWithServices<
  ReturnType<typeof createLevelingServices>
> {
  const services = createLevelingServices({ db, logger });
  const commands = createLevelingCommands(services, logger);
  const events = createLevelingEventHandlers(services, logger);

  return {
    services,
    commands: commands.commands,
    autocompletes: commands.autocompletes,
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: events.eventHandlers,
  };
}
