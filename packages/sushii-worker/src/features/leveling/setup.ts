import type { Client } from "discord.js";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { CollectionArtwork } from "@/features/social/infrastructure/CollectionArtwork";
import { DrizzleFishyCollectionRepository } from "@/features/social/infrastructure/DrizzleFishyCollectionRepository";
import type * as schema from "@/infrastructure/database/schema";
import { env } from "@/shared/infrastructure/config/env";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { GetGlobalLeaderboardService } from "./application/GetGlobalLeaderboardService";
import { GetLeaderboardService } from "./application/GetLeaderboardService";
import { GetUserRankService } from "./application/GetUserRankService";
import { LevelRoleService } from "./application/LevelRoleService";
import { UpdateUserXpService } from "./application/UpdateUserXpService";
import { XpBlockService } from "./application/XpBlockService";
import { LevelRoleRepositoryImpl } from "./infrastructure/LevelRoleRepositoryImpl";
import { UserLevelRepository } from "./infrastructure/UserLevelRepository";
import { UserProfileRepository } from "./infrastructure/UserProfileRepository";
import { XpBlockRepositoryImpl } from "./infrastructure/XpBlockRepositoryImpl";
import { GlobalLeaderboardRefreshTask } from "./infrastructure/tasks/GlobalLeaderboardRefreshTask";
import { OpenFishyCollectionButtonHandler } from "./presentation/OpenFishyCollectionButtonHandler";
import { FishyCollectionCommand } from "./presentation/commands/FishyCollectionCommand";
import GlobalLeaderboardCommand from "./presentation/commands/GlobalLeaderboardCommand";
import LeaderboardCommand from "./presentation/commands/LeaderboardCommand";
import LeaderboardPrivacyCommand from "./presentation/commands/LeaderboardPrivacyCommand";
import LevelRoleCommand from "./presentation/commands/LevelRoleCommand";
import RankCommand from "./presentation/commands/RankCommand";
import XpCommand from "./presentation/commands/XpCommands";
import { MessageLevelHandler } from "./presentation/events/MessageLevelHandler";

interface LevelingServiceDependencies {
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
  emojiRepository: BotEmojiRepository;
}

interface LevelingDependencies extends LevelingServiceDependencies {
  client: Client;
  deploymentService: DeploymentService;
}

export function createLevelingServices({
  db,
  logger,
  emojiRepository,
}: LevelingServiceDependencies) {
  const userProfileRepository = new UserProfileRepository(db);
  const userLevelRepository = new UserLevelRepository(db);
  const levelRoleRepository = new LevelRoleRepositoryImpl(db);
  const xpBlockRepository = new XpBlockRepositoryImpl(db);

  const getUserRankService = new GetUserRankService(
    userProfileRepository,
    userLevelRepository,
  );

  const getLeaderboardService = new GetLeaderboardService(userLevelRepository);
  const getGlobalLeaderboardService = new GetGlobalLeaderboardService(
    userLevelRepository,
  );

  const updateUserXpService = new UpdateUserXpService(
    userLevelRepository,
    levelRoleRepository,
    xpBlockRepository,
  );

  const levelRoleService = new LevelRoleService(levelRoleRepository);

  const xpBlockService = new XpBlockService(
    xpBlockRepository,
    logger.child({ module: "XpBlockService" }),
  );

  return {
    collectionRepository: new DrizzleFishyCollectionRepository(db),
    collectionArtwork: new CollectionArtwork(
      env.ASSET_DIR,
      env.ASSET_PUBLIC_BASE_URL,
      env.ASSET_REVISION,
    ),
    userProfileRepository,
    userLevelRepository,
    levelRoleRepository,
    xpBlockRepository,
    getUserRankService,
    getLeaderboardService,
    getGlobalLeaderboardService,
    updateUserXpService,
    levelRoleService,
    xpBlockService,
    emojiRepository,
  };
}

export function createLevelingCommands(
  services: ReturnType<typeof createLevelingServices>,
  logger: Logger,
) {
  const {
    userProfileRepository,
    getUserRankService,
    getLeaderboardService,
    getGlobalLeaderboardService,
    levelRoleService,
    xpBlockService,
    emojiRepository,
  } = services;

  const overview = {
    rankService: getUserRankService,
    emojiRepository,
    collectionRepository: services.collectionRepository,
    artwork: services.collectionArtwork,
    logger: logger.child({ module: "UserOverview" }),
  };
  const commands = [
    new RankCommand(overview),
    new FishyCollectionCommand(overview),
    new LeaderboardCommand(getLeaderboardService),
    new GlobalLeaderboardCommand(getGlobalLeaderboardService),
    new LeaderboardPrivacyCommand(
      userProfileRepository,
      logger.child({ module: "leaderboard-privacy" }),
    ),
    new LevelRoleCommand(levelRoleService),
    new XpCommand(xpBlockService),
  ];

  return {
    commands,
    buttonHandlers: [new OpenFishyCollectionButtonHandler(overview)],
    autocompletes: [],
  };
}

export function createLevelingEventHandlers(
  services: ReturnType<typeof createLevelingServices>,
  _logger: Logger,
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
  emojiRepository,
  client,
  deploymentService,
}: LevelingDependencies): FullFeatureSetupReturn<
  ReturnType<typeof createLevelingServices>
> {
  const services = createLevelingServices({ db, logger, emojiRepository });
  const commands = createLevelingCommands(services, logger);
  const events = createLevelingEventHandlers(services, logger);

  const taskLogger = logger.child({ component: "GlobalLeaderboardRefresh" });
  const tasks = [
    new GlobalLeaderboardRefreshTask(
      client,
      deploymentService,
      taskLogger,
      db,
      sql`REFRESH MATERIALIZED VIEW CONCURRENTLY app_public.global_user_level_rankings_all_time`,
      "Global leaderboard refresh all-time",
      "*/30 * * * *",
    ),
    new GlobalLeaderboardRefreshTask(
      client,
      deploymentService,
      taskLogger,
      db,
      sql`REFRESH MATERIALIZED VIEW CONCURRENTLY app_public.global_user_level_rankings_month`,
      "Global leaderboard refresh month",
      "*/30 * * * *",
    ),
    new GlobalLeaderboardRefreshTask(
      client,
      deploymentService,
      taskLogger,
      db,
      sql`REFRESH MATERIALIZED VIEW CONCURRENTLY app_public.global_user_level_rankings_week`,
      "Global leaderboard refresh week",
      "*/15 * * * *",
    ),
    new GlobalLeaderboardRefreshTask(
      client,
      deploymentService,
      taskLogger,
      db,
      sql`REFRESH MATERIALIZED VIEW CONCURRENTLY app_public.global_user_level_rankings_day`,
      "Global leaderboard refresh day",
      "*/5 * * * *",
    ),
  ];

  return {
    services,
    commands: commands.commands,
    autocompletes: commands.autocompletes,
    contextMenuHandlers: [],
    buttonHandlers: commands.buttonHandlers,
    eventHandlers: events.eventHandlers,
    tasks,
  };
}
