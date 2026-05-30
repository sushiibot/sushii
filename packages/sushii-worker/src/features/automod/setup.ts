import type { Client } from "discord.js";
import type { Events } from "discord.js";
import type { Logger } from "pino";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import type * as schema from "@/infrastructure/database/schema";

import { AutomodAlertCache } from "./application/AutomodAlertCache";
import { AutomodAlertReactionService } from "./application/AutomodAlertReactionService";
import { InviteInfoService } from "./application/InviteInfoService";
import { ScamImageHashService } from "./application/ScamImageHashService";
import { SpamActionService } from "./application/SpamActionService";
import { SpamAlertCache } from "./application/SpamAlertCache";
import { SpamAlertUpdateService } from "./application/SpamAlertUpdateService";
import { SpamDetectionService } from "./application/SpamDetectionService";
import { DrizzleScamImageHashRepository } from "./infrastructure/DrizzleScamImageHashRepository";
import { ScamImageMetrics } from "./infrastructure/metrics/ScamImageMetrics";
import { AutomodAlertExecutionHandler } from "./presentation/events/AutomodAlertExecutionHandler";
import { AutomodMessageHandler } from "./presentation/events/AutomodMessageHandler";
import { ScamHashDMHandler } from "./presentation/events/ScamHashDMHandler";
import { ScamHashCommand } from "./presentation/commands/ScamHashCommand";

export interface AutomodFeature {
  eventHandlers: [AutomodMessageHandler, AutomodAlertExecutionHandler, ScamHashDMHandler];
  services: {
    automodAlertReactionService: AutomodAlertReactionService;
    spamAlertUpdateService: SpamAlertUpdateService;
  };
  commands: [ScamHashCommand];
  destroy(): void;
}

export interface AutomodFeatureOptions {
  guildConfigRepository: GuildConfigRepository;
  emojiRepository: BotEmojiRepository;
  client: Client;
  logger: Logger;
  db: NodePgDatabase<typeof schema>;
}

export function setupAutomodFeature(
  options: AutomodFeatureOptions,
): AutomodFeature {
  const { guildConfigRepository, emojiRepository, client, logger, db } =
    options;

  // Services
  const spamDetectionService = new SpamDetectionService(
    logger.child({ component: "SpamDetectionService" }),
  );

  const spamAlertCache = new SpamAlertCache();

  const spamActionService = new SpamActionService(
    client,
    spamAlertCache,
    logger.child({ component: "SpamActionService" }),
  );

  const spamAlertUpdateService = new SpamAlertUpdateService(
    client,
    spamAlertCache,
    logger.child({ component: "SpamAlertUpdateService" }),
  );

  const automodAlertCache = new AutomodAlertCache();

  const automodAlertReactionService = new AutomodAlertReactionService(
    automodAlertCache,
    emojiRepository,
    logger.child({ component: "AutomodAlertReactionService" }),
  );

  const scamImageHashRepository = new DrizzleScamImageHashRepository(db);
  const scamImageMetrics = new ScamImageMetrics();

  const scamImageHashService = new ScamImageHashService(
    scamImageHashRepository,
    logger.child({ component: "ScamImageHashService" }),
    scamImageMetrics,
  );

  // Event handlers
  const automodMessageHandler = new AutomodMessageHandler(
    spamDetectionService,
    spamActionService,
    scamImageHashService,
    guildConfigRepository,
    logger.child({ component: "AutomodMessageHandler" }),
  );

  const inviteInfoService = new InviteInfoService(
    client,
    logger.child({ component: "InviteInfoService" }),
  );

  const automodAlertExecutionHandler = new AutomodAlertExecutionHandler(
    automodAlertCache,
    inviteInfoService,
    logger.child({ component: "AutomodAlertExecutionHandler" }),
  );

  const scamHashDMHandler = new ScamHashDMHandler(
    scamImageHashRepository,
    scamImageHashService,
    logger.child({ component: "ScamHashDMHandler" }),
  );

  // Commands
  const scamHashCommand = new ScamHashCommand(
    scamImageHashRepository,
    scamImageHashService,
    logger.child({ component: "ScamHashCommand" }),
  );

  return {
    eventHandlers: [automodMessageHandler, automodAlertExecutionHandler, scamHashDMHandler],
    services: {
      automodAlertReactionService,
      spamAlertUpdateService,
    },
    commands: [scamHashCommand],
    destroy: () => spamDetectionService.destroy(),
  };
}
