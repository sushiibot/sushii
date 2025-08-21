import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import {
  EmojiStatsQueryService,
  EmojiStatsTrackingService,
  GuildAssetSyncService,
} from "./application";
import { RateLimitService } from "./domain";
import {
  DrizzleEmojiStickerStatsRepository,
  DrizzleGuildAssetRepository,
  DrizzleRateLimitRepository,
} from "./infrastructure";
import { RateLimitCleanupTask } from "./infrastructure/tasks/RateLimitCleanupTask";
import {
  ClientReadyAssetSyncHandler,
  EmojiCreateSyncHandler,
  EmojiStatsCommand,
  EmojiUpdateSyncHandler,
  MessageEmojiTrackingHandler,
  ReactionEmojiTrackingHandler,
  StickerCreateSyncHandler,
  StickerUpdateSyncHandler,
} from "./presentation";

export interface EmojiStatsFeatureDependencies {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  deploymentService: DeploymentService;
}

interface EmojiStatsServices {
  emojiStatsTrackingService: EmojiStatsTrackingService;
  emojiStatsQueryService: EmojiStatsQueryService;
  guildAssetSyncService: GuildAssetSyncService;
}

export function setupEmojiStatsFeature(
  dependencies: EmojiStatsFeatureDependencies,
): FullFeatureSetupReturn<EmojiStatsServices> {
  const { db, client, deploymentService } = dependencies;

  // Infrastructure layer
  const guildAssetRepository = new DrizzleGuildAssetRepository(db);
  const rateLimitRepository = new DrizzleRateLimitRepository(db);
  const emojiStickerStatsRepository = new DrizzleEmojiStickerStatsRepository(
    db,
  );

  // Domain services
  const rateLimitService = new RateLimitService(rateLimitRepository);

  // Application services
  const emojiStatsTrackingService = new EmojiStatsTrackingService(
    guildAssetRepository,
    emojiStickerStatsRepository,
    rateLimitService,
  );

  const emojiStatsQueryService = new EmojiStatsQueryService(
    emojiStickerStatsRepository,
  );

  const guildAssetSyncService = new GuildAssetSyncService(
    guildAssetRepository,
    client,
  );

  // Commands
  const emojiStatsCommand = new EmojiStatsCommand(emojiStatsQueryService);

  // Event handlers
  const messageEmojiTrackingHandler = new MessageEmojiTrackingHandler(
    emojiStatsTrackingService,
  );
  const reactionEmojiTrackingHandler = new ReactionEmojiTrackingHandler(
    emojiStatsTrackingService,
  );
  const clientReadyAssetSyncHandler = new ClientReadyAssetSyncHandler(
    guildAssetSyncService,
  );
  const emojiCreateSyncHandler = new EmojiCreateSyncHandler(
    guildAssetSyncService,
  );
  const emojiUpdateSyncHandler = new EmojiUpdateSyncHandler(
    guildAssetSyncService,
  );
  const stickerCreateSyncHandler = new StickerCreateSyncHandler(
    guildAssetSyncService,
  );
  const stickerUpdateSyncHandler = new StickerUpdateSyncHandler(
    guildAssetSyncService,
  );

  // Background tasks
  const rateLimitCleanupTask = new RateLimitCleanupTask(
    client,
    deploymentService,
    rateLimitRepository,
  );

  return {
    services: {
      emojiStatsTrackingService,
      emojiStatsQueryService,
      guildAssetSyncService,
    },
    commands: [emojiStatsCommand],
    eventHandlers: [
      messageEmojiTrackingHandler,
      reactionEmojiTrackingHandler,
      clientReadyAssetSyncHandler,
      emojiCreateSyncHandler,
      emojiUpdateSyncHandler,
      stickerCreateSyncHandler,
      stickerUpdateSyncHandler,
    ],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    tasks: [rateLimitCleanupTask],
  };
}
