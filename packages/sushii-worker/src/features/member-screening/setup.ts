import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { DrizzleBotEmojiRepository } from "@/features/bot-emojis/infrastructure";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { FeatureFlagRepository } from "@/features/feature-flags/domain/FeatureFlagRepository";
import type { ModerationService } from "@/features/moderation/actions/application/ModerationService";
import type { ActionReasonFormDeps } from "@/features/moderation/actions/presentation/components/reasonFormSubmit";
import { ReasonTemplateService } from "@/features/moderation/reason-templates/application/ReasonTemplateService";
import { DrizzleReasonTemplateRepository } from "@/features/moderation/reason-templates/infrastructure/DrizzleReasonTemplateRepository";
import type { ModerationMetrics } from "@/features/moderation/shared/domain/metrics/ModerationMetrics";
import { DrizzleModLogRepository } from "@/features/moderation/shared/infrastructure/repositories/DrizzleModLogRepository";
import type * as schema from "@/infrastructure/database/schema";
import type { SelectMenuHandler } from "@/shared/presentation/handlers";
import type {
  EventHandlers,
  FullFeatureSetupReturn,
} from "@/shared/types/FeatureSetup";

import { MemberScreeningService } from "./application/MemberScreeningService";
import { ScreeningActivation } from "./application/ScreeningActivation";
import { ScreeningPostRenderer } from "./application/ScreeningPostRenderer";
import { ScreeningSettingsLookup } from "./application/ScreeningSettingsLookup";
import { ScreeningSettingsService } from "./application/ScreeningSettingsService";
import type { ScreeningClassifier } from "./domain/ScreeningClassifier";
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
import { ScreeningActionButtonHandler } from "./presentation/handlers/ScreeningActionButtonHandler";
import { ScreeningIgnoreSelectHandler } from "./presentation/handlers/ScreeningIgnoreSelectHandler";

export interface MemberScreeningFeatureOptions {
  client: Client;
  db: NodePgDatabase<typeof schema>;
  logger: Logger;
  flagRepository: FeatureFlagRepository;
  deploymentService: DeploymentService;
  moderationService: Pick<ModerationService, "executeAction">;
  moderationMetrics: ModerationMetrics;
  openRouterApiKey?: string;
  ownerUserId?: string;
}

interface MemberScreeningServices {
  /** Also the screening state reader for `/feature-flag list`. */
  settingsPort: ScreeningSettingsService;
  flagRepository: FeatureFlagRepository;
  /** For the message cache; resolves false instead of throwing when the lookup fails. */
  shouldCacheForScreening: (guildId: string) => Promise<boolean>;
}

export interface MemberScreeningFeature
  extends FullFeatureSetupReturn<MemberScreeningServices> {
  selectMenuHandlers: SelectMenuHandler[];
}

/**
 * Built from db here because the moderation feature's instances aren't passed
 * to this feature; the repositories and service are stateless.
 */
function createReasonFormDeps(
  db: NodePgDatabase<typeof schema>,
  logger: Logger,
  moderationMetrics: ModerationMetrics,
): ActionReasonFormDeps {
  const modLogRepository = new DrizzleModLogRepository(
    db,
    logger.child({ component: "ScreeningModLogRepository" }),
  );

  return {
    reasonTemplateService: new ReasonTemplateService(
      new DrizzleReasonTemplateRepository(db),
      modLogRepository,
      moderationMetrics,
    ),
    emojiRepository: new DrizzleBotEmojiRepository(db),
    metrics: moderationMetrics,
    logger: logger.child({ component: "ScreeningReasonForm" }),
  };
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
  flagRepository,
  deploymentService,
  moderationService,
  moderationMetrics,
  openRouterApiKey,
  ownerUserId,
}: MemberScreeningFeatureOptions): MemberScreeningFeature {
  const guildRepository = new DrizzleScreeningGuildRepository(
    db,
    logger.child({ component: "ScreeningGuildRepository" }),
  );
  const verdictRepository = new DrizzleScreeningVerdictRepository(db);
  const contextRepository = new DrizzleScreeningMessageContextRepository(db);
  const settingsPort = new ScreeningSettingsService(
    flagRepository,
    guildRepository,
  );
  // One lookup for every entry point, so a flag or DB outage warns once a minute in total.
  const activeSettings = new ScreeningSettingsLookup(
    new ScreeningActivation(flagRepository, guildRepository),
    logger.child({ component: "ScreeningSettingsLookup" }),
  );

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
    activeSettings,
    verdictRepository,
    contextRepository,
    classifier,
    publisher,
    renderer,
    metrics,
    logger.child({ component: "MemberScreeningService" }),
  );

  const eventHandlers: EventHandlers = [
    new ScreeningAuditLogHandler(service, activeSettings, client),
    new ScreeningMessageDeleteHandler(service, activeSettings),
  ];

  if (openRouterApiKey) {
    eventHandlers.push(
      new ScreeningMessageHandler(service, activeSettings, client),
      new ScreeningAutomodHandler(
        service,
        activeSettings,
        logger.child({ component: "ScreeningAutomodHandler" }),
      ),
    );
  } else {
    logger.info(
      "OPENROUTER_API_KEY not set, member screening message checks disabled",
    );
  }

  return {
    commands: [
      new MemberScreeningCommand(
        guildRepository,
        flagRepository,
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
        createReasonFormDeps(db, logger, moderationMetrics),
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
      settingsPort,
      flagRepository,
      // Without a key nothing is screened, so other members' messages aren't needed as context.
      shouldCacheForScreening: async (guildId) =>
        !!openRouterApiKey && (await activeSettings.find(guildId)) !== null,
    },
  };
}
