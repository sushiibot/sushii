import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { DrizzleUserProfileRepository } from "@/features/user-profile/infrastructure/DrizzleUserProfileRepository";
import type * as schema from "@/infrastructure/database/schema";
import { env } from "@/shared/infrastructure/config/env";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import {
  CooldownService,
  FishyLeaderboardService,
  FishyService,
  RepLeaderboardService,
  ReputationService,
} from "./application";
import { DrizzleSocialLeaderboardRepository } from "./infrastructure";
import { CollectionArtwork } from "./infrastructure/CollectionArtwork";
import { DrizzleFishyCollectionRepository } from "./infrastructure/DrizzleFishyCollectionRepository";
import {
  FishyCommand,
  FishyLeaderboardCommand,
  RepCommand,
  RepLeaderboardCommand,
} from "./presentation/commands";

interface SocialFeatureServices {
  cooldownService: CooldownService;
  fishyService: FishyService;
  reputationService: ReputationService;
  getRepLeaderboardService: RepLeaderboardService;
  getFishyLeaderboardService: FishyLeaderboardService;
}

interface SetupParams {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
}

export function setupSocialFeature({
  db,
  client: _client,
  logger: _logger,
}: SetupParams): FullFeatureSetupReturn<SocialFeatureServices> {
  // Import repositories
  const userProfileRepository = new DrizzleUserProfileRepository(db);
  const socialLeaderboardRepository = new DrizzleSocialLeaderboardRepository(
    db,
  );

  // Create services
  const cooldownService = new CooldownService();
  const collectionRepository = new DrizzleFishyCollectionRepository(db);
  const fishyService = new FishyService(collectionRepository);
  const reputationService = new ReputationService(collectionRepository);
  const getRepLeaderboardService = new RepLeaderboardService(
    socialLeaderboardRepository,
    userProfileRepository,
  );
  const getFishyLeaderboardService = new FishyLeaderboardService(
    socialLeaderboardRepository,
    userProfileRepository,
  );

  // Create commands
  const fishyCommand = new FishyCommand(
    fishyService,
    new CollectionArtwork(env.ASSET_DIR),
  );
  const repCommand = new RepCommand(reputationService);
  const repLeaderboardCommand = new RepLeaderboardCommand(
    getRepLeaderboardService,
  );
  const fishyLeaderboardCommand = new FishyLeaderboardCommand(
    getFishyLeaderboardService,
  );

  return {
    services: {
      cooldownService,
      fishyService,
      reputationService,
      getRepLeaderboardService,
      getFishyLeaderboardService,
    },
    commands: [
      fishyCommand,
      repCommand,
      repLeaderboardCommand,
      fishyLeaderboardCommand,
    ],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [],
    tasks: [],
  };
}
