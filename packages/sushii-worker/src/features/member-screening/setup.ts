import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { DrizzleFeatureFlagRepository } from "@/features/feature-flags/infrastructure/DrizzleFeatureFlagRepository";
import type { ModerationService } from "@/features/moderation/actions/application/ModerationService";
import type * as schema from "@/infrastructure/database/schema";
import type { SelectMenuHandler } from "@/shared/presentation/handlers";
import type {
  EventHandlers,
  FullFeatureSetupReturn,
} from "@/shared/types/FeatureSetup";

import { MemberScreeningService } from "./application/MemberScreeningService";
import { ScreeningPostRenderer } from "./application/ScreeningPostRenderer";
import type { ScreeningClassifier } from "./domain/ScreeningClassifier";
import type { ScreeningGuildRepository } from "./domain/repositories/ScreeningGuildRepository";
import { DiscordScreeningPostPublisher } from "./infrastructure/DiscordScreeningPostPublisher";
import { DrizzleScreeningGuildRepository } from "./infrastructure/DrizzleScreeningGuildRepository";
import { DrizzleScreeningMessageContextRepository } from "./infrastructure/DrizzleScreeningMessageContextRepository";
import { DrizzleScreeningVerdictRepository } from "./infrastructure/DrizzleScreeningVerdictRepository";
import { OpenRouterScreeningClassifier } from "./infrastructure/OpenRouterScreeningClassifier";
import { OtelScreeningMetrics } from "./infrastructure/metrics/OtelScreeningMetrics";
import { ScreeningVerdictRetentionTask } from "./infrastructure/tasks/ScreeningVerdictRetentionTask";
import { MemberScreeningCommand } from "./presentation/commands/MemberScreeningCommand";
import { ScreeningAuditLogHandler } from "./presentation/events/ScreeningAuditLogHandler";
import { ScreeningAutomodHandler } from "./presentation/events/ScreeningAutomodHandler";
import { ScreeningMessageDeleteHandler } from "./presentation/events/ScreeningMessageDeleteHandler";
import { ScreeningMessageHandler } from "./presentation/events/ScreeningMessageHandler";
import { ScreeningSettingsLookup } from "./presentation/events/ScreeningSettingsLookup";
import { ScreeningActionButtonHandler } from "./presentation/handlers/ScreeningActionButtonHandler";
import { ScreeningIgnoreSelectHandler } from "./presentation/handlers/ScreeningIgnoreSelectHandler";

export interface MemberScreeningFeatureOptions {
  client: Client;
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
  deploymentService: DeploymentService;
  moderationService: Pick<ModerationService, "executeAction">;
  openRouterApiKey?: string;
  ownerUserId?: string;
}

interface MemberScreeningServices {
  guildRepository: ScreeningGuildRepository;
  /** For the message cache; resolves false instead of throwing when the lookup fails. */
  shouldCacheForScreening: (guildId: string) => Promise<boolean>;
}

export interface MemberScreeningFeature
  extends FullFeatureSetupReturn<MemberScreeningServices> {
  selectMenuHandlers: SelectMenuHandler[];
}

// Only reachable from the message and automod handlers, which aren't registered without a key.
const unconfiguredClassifier: ScreeningClassifier = {
  classifyText: () =>
    Promise.reject(new Error("Screening classifier not configured")),
  classifyImage: () =>
    Promise.reject(new Error("Screening classifier not configured")),
};

export function setupMemberScreeningFeature({
  client,
  db,
  logger,
  deploymentService,
  moderationService,
  openRouterApiKey,
  ownerUserId,
}: MemberScreeningFeatureOptions): MemberScreeningFeature {
  const guildRepository = new DrizzleScreeningGuildRepository(
    db,
    logger.child({ component: "ScreeningGuildRepository" }),
  );
  const verdictRepository = new DrizzleScreeningVerdictRepository(db);
  const contextRepository = new DrizzleScreeningMessageContextRepository(db);

  const metrics = new OtelScreeningMetrics();
  const renderer = new ScreeningPostRenderer(
    guildRepository,
    verdictRepository,
  );
  const publisher = new DiscordScreeningPostPublisher(client);

  const classifier: ScreeningClassifier = openRouterApiKey
    ? new OpenRouterScreeningClassifier(
        openRouterApiKey,
        logger.child({ component: "OpenRouterScreeningClassifier" }),
      )
    : unconfiguredClassifier;

  const service = new MemberScreeningService(
    guildRepository,
    verdictRepository,
    contextRepository,
    classifier,
    publisher,
    renderer,
    metrics,
    logger.child({ component: "MemberScreeningService" }),
  );

  const eventHandlers: EventHandlers = [
    new ScreeningAuditLogHandler(
      service,
      guildRepository,
      client,
      logger.child({ component: "ScreeningAuditLogHandler" }),
    ),
    new ScreeningMessageDeleteHandler(
      service,
      guildRepository,
      logger.child({ component: "ScreeningMessageDeleteHandler" }),
    ),
  ];

  if (openRouterApiKey) {
    eventHandlers.push(
      new ScreeningMessageHandler(
        service,
        guildRepository,
        client,
        logger.child({ component: "ScreeningMessageHandler" }),
      ),
      new ScreeningAutomodHandler(
        service,
        guildRepository,
        logger.child({ component: "ScreeningAutomodHandler" }),
      ),
    );
  } else {
    logger.info(
      "OPENROUTER_API_KEY not set, member screening message checks disabled",
    );
  }

  const cacheLookup = new ScreeningSettingsLookup(
    guildRepository,
    logger.child({ component: "ScreeningCacheLookup" }),
  );

  return {
    commands: [
      new MemberScreeningCommand(
        guildRepository,
        new DrizzleFeatureFlagRepository(
          db,
          logger.child({ component: "FeatureFlagRepository" }),
        ),
        verdictRepository,
        ownerUserId,
        logger.child({ commandHandler: "member-screening" }),
      ),
    ],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [
      new ScreeningActionButtonHandler(
        moderationService,
        verdictRepository,
        renderer,
        service,
        metrics,
        logger.child({ buttonHandler: "screening-action" }),
      ),
    ],
    selectMenuHandlers: [
      new ScreeningIgnoreSelectHandler(
        verdictRepository,
        renderer,
        metrics,
        logger.child({ selectMenuHandler: "screening-ignore" }),
      ),
    ],
    eventHandlers,
    tasks: [
      new ScreeningVerdictRetentionTask(
        client,
        deploymentService,
        verdictRepository,
      ),
    ],
    services: {
      guildRepository,
      // Without a key nothing is screened, so other members' messages aren't needed as context.
      shouldCacheForScreening: async (guildId) =>
        !!openRouterApiKey && (await cacheLookup.find(guildId)) !== null,
    },
  };
}
