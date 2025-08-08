import { Client } from "discord.js";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { DrizzleUserProfileRepository } from "./infrastructure/DrizzleUserProfileRepository";
import { AvatarCommand } from "./presentation/commands/AvatarCommand";
import { BannerCommand } from "./presentation/commands/BannerCommand";
import { UserInfoCommand } from "./presentation/commands/UserInfoCommand";

interface UserProfileFeatureServices {
  userProfileRepository: DrizzleUserProfileRepository;
}

interface SetupParams {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
}

export function setupUserProfileFeature({
  db,
  client,
  logger,
}: SetupParams): FullFeatureSetupReturn<UserProfileFeatureServices> {
  // Create repositories
  const userProfileRepository = new DrizzleUserProfileRepository(db);

  // Create commands
  const avatarCommand = new AvatarCommand(client, logger);
  const bannerCommand = new BannerCommand(client, logger);
  const userInfoCommand = new UserInfoCommand(client, logger);

  return {
    services: {
      userProfileRepository,
    },
    commands: [avatarCommand, bannerCommand, userInfoCommand],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [],
    tasks: [],
  };
}