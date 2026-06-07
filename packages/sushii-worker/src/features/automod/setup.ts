import type { Client } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { BotEmojiRepository } from "@/features/bot-emojis/domain/repositories/BotEmojiRepository";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import type * as schema from "@/infrastructure/database/schema";

import { AutomodAlertCache } from "./application/AutomodAlertCache";
import { AutomodAlertReactionService } from "./application/AutomodAlertReactionService";
import { InviteInfoService } from "./application/InviteInfoService";
import { ScamCandidateService } from "./application/ScamCandidateService";
import { ScamImageClassifier } from "./application/ScamImageClassifier";
import { ScamImageHashService } from "./application/ScamImageHashService";
import { SpamActionService } from "./application/SpamActionService";
import { SpamAlertCache } from "./application/SpamAlertCache";
import { SpamAlertUpdateService } from "./application/SpamAlertUpdateService";
import { SpamDetectionService } from "./application/SpamDetectionService";
import { DrizzleScamCandidateRepository } from "./infrastructure/DrizzleScamCandidateRepository";
import { DrizzleScamImageHashRepository } from "./infrastructure/DrizzleScamImageHashRepository";
import { ScamCandidateMetrics } from "./infrastructure/metrics/ScamCandidateMetrics";
import { ScamClassifierMetrics } from "./infrastructure/metrics/ScamClassifierMetrics";
import { ScamImageMetrics } from "./infrastructure/metrics/ScamImageMetrics";
import { ScamCandidateJanitorTask } from "./infrastructure/tasks/ScamCandidateJanitorTask";
import { AutomodAlertExecutionHandler } from "./presentation/events/AutomodAlertExecutionHandler";
import { AutomodMessageHandler } from "./presentation/events/AutomodMessageHandler";
import { ScamHashDMHandler } from "./presentation/events/ScamHashDMHandler";
import { ScamHashCommand } from "./presentation/commands/ScamHashCommand";
import { ScamCandidateButtonHandler } from "./presentation/handlers/ScamCandidateButtonHandler";
import { ScamCandidateLabelModalHandler } from "./presentation/handlers/ScamCandidateLabelModalHandler";
import type { ScamImageStore } from "./infrastructure/ScamImageStore";

export interface AutomodFeature {
  eventHandlers: [AutomodMessageHandler, AutomodAlertExecutionHandler, ScamHashDMHandler];
  buttonHandlers: [ScamCandidateButtonHandler];
  modalHandlers: [ScamCandidateLabelModalHandler];
  services: {
    automodAlertReactionService: AutomodAlertReactionService;
    spamAlertUpdateService: SpamAlertUpdateService;
  };
  commands: [ScamHashCommand];
  tasks: [ScamCandidateJanitorTask];
  destroy(): void;
}

export interface AutomodFeatureOptions {
  guildConfigRepository: GuildConfigRepository;
  emojiRepository: BotEmojiRepository;
  client: Client;
  deploymentService: DeploymentService;
  logger: Logger;
  db: NodePgDatabase<typeof schema>;
  openRouterApiKey?: string;
  openRouterScamClassifyModel?: string;
  scamImageStore?: ScamImageStore;
}

export function setupAutomodFeature(
  options: AutomodFeatureOptions,
): AutomodFeature {
  const { guildConfigRepository, emojiRepository, client, deploymentService, logger, db, openRouterApiKey, openRouterScamClassifyModel, scamImageStore } =
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
  const scamCandidateRepository = new DrizzleScamCandidateRepository(db);
  const scamImageMetrics = new ScamImageMetrics();
  scamImageStore?.setMetrics(scamImageMetrics);

  const scamImageHashService = new ScamImageHashService(
    scamImageHashRepository,
    logger.child({ component: "ScamImageHashService" }),
    scamImageMetrics,
    scamImageStore,
  );

  const scamClassifierMetrics = new ScamClassifierMetrics();
  const scamImageClassifier =
    openRouterApiKey && openRouterScamClassifyModel
      ? new ScamImageClassifier(
          openRouterApiKey,
          openRouterScamClassifyModel,
          logger.child({ component: "ScamImageClassifier" }),
          scamClassifierMetrics,
        )
      : undefined;

  const scamCandidateMetrics = new ScamCandidateMetrics();
  const scamCandidateService = new ScamCandidateService(
    client,
    scamImageHashService,
    scamImageHashRepository,
    scamCandidateRepository,
    scamCandidateMetrics,
    logger.child({ component: "ScamCandidateService" }),
    scamImageClassifier,
    scamImageStore,
  );

  // Event handlers
  const automodMessageHandler = new AutomodMessageHandler(
    spamDetectionService,
    spamActionService,
    scamImageHashService,
    scamCandidateService,
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

  // Interaction handlers for scam candidate review buttons and modal
  const scamCandidateButtonHandler = new ScamCandidateButtonHandler(scamCandidateService);
  const scamCandidateLabelModalHandler = new ScamCandidateLabelModalHandler(scamCandidateService);

  // Background tasks
  const scamCandidateJanitorTask = new ScamCandidateJanitorTask(
    client,
    deploymentService,
    logger.child({ component: "ScamCandidateJanitorTask" }),
    scamCandidateService,
  );

  client.once(Events.ClientReady, (readyClient) => {
    void scamHashDMHandler.primeOwnerDMChannel(readyClient);
  });

  return {
    eventHandlers: [automodMessageHandler, automodAlertExecutionHandler, scamHashDMHandler],
    buttonHandlers: [scamCandidateButtonHandler],
    modalHandlers: [scamCandidateLabelModalHandler],
    services: {
      automodAlertReactionService,
      spamAlertUpdateService,
    },
    commands: [scamHashCommand],
    tasks: [scamCandidateJanitorTask],
    destroy: () => {
      spamDetectionService.destroy();
      scamCandidateService.destroy();
    },
  };
}
