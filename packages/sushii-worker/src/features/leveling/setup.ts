import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";

import { GetLeaderboardService } from "./application/GetLeaderboardService";
import { GetUserRankService } from "./application/GetUserRankService";
import { UpdateUserXpService } from "./application/UpdateUserXpService";
import { LevelRoleRepositoryImpl } from "./infrastructure/LevelRoleRepositoryImpl";
import { UserLevelRepository } from "./infrastructure/UserLevelRepository";
import { UserProfileRepository } from "./infrastructure/UserProfileRepository";
import { XpBlockRepositoryImpl } from "./infrastructure/XpBlockRepositoryImpl";
import LeaderboardCommand from "./presentation/commands/LeaderboardCommand";
import { MessageLevelHandler } from "./presentation/commands/MessageLevelHandler";
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

  return {
    userProfileRepository,
    userLevelRepository,
    levelRoleRepository,
    xpBlockRepository,
    getUserRankService,
    getLeaderboardService,
    updateUserXpService,
  };
}

export function createLevelingCommands(
  services: ReturnType<typeof createLevelingServices>,
  logger: Logger,
) {
  const { getUserRankService, getLeaderboardService } = services;

  const commands = [
    new RankCommand(getUserRankService, logger.child({ module: "rank" })),
    new LeaderboardCommand(getLeaderboardService),
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

export function setupLevelingFeature({ db, logger }: LevelingDependencies) {
  const services = createLevelingServices({ db, logger });
  const commands = createLevelingCommands(services, logger);
  const events = createLevelingEventHandlers(services, logger);

  return {
    services,
    ...commands,
    ...events,
  };
}
