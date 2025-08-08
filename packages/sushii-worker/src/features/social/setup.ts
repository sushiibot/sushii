import { Client } from "discord.js";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";
import { DrizzleUserProfileRepository } from "@/features/user-profile/infrastructure/DrizzleUserProfileRepository";

import { CooldownService, FishyService, ReputationService } from "./application";
import { FishyCommand, RepCommand } from "./presentation/commands";

interface SocialFeatureServices {
  cooldownService: CooldownService;
  fishyService: FishyService;
  reputationService: ReputationService;
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
  // Import user profile repository
  const userProfileRepository = new DrizzleUserProfileRepository(db);

  // Create services
  const cooldownService = new CooldownService();
  const fishyService = new FishyService(userProfileRepository, cooldownService);
  const reputationService = new ReputationService(userProfileRepository, cooldownService);

  // Create commands
  const fishyCommand = new FishyCommand(fishyService);
  const repCommand = new RepCommand(reputationService);

  return {
    services: {
      cooldownService,
      fishyService,
      reputationService,
    },
    commands: [fishyCommand, repCommand],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [],
    tasks: [],
  };
}