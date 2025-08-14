import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { SlashCommandHandler } from "@/interactions/handlers";
import { DrizzleGuildConfigRepository } from "@/shared/infrastructure/DrizzleGuildConfigRepository";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

// Actions sub-feature
import {
  DMPolicyService,
  ModerationExecutionPipeline,
  ModerationService,
  TargetResolutionService,
} from "./actions/application";
import { ModerationCommand } from "./actions/presentation";
import { AuditLogEventHandler } from "./audit-logs";
// Audit logs sub-feature
import {
  AuditLogOrchestrationService,
  AuditLogProcessingService,
  ModLogPostingService,
  NativeTimeoutDMService,
} from "./audit-logs/application";
import { DiscordAuditLogService } from "./audit-logs/infrastructure";
// Button handlers
import {
  ModLogDeleteDMButtonHandler,
  ModLogReasonButtonHandler,
} from "./audit-logs/presentation/components";
// Cases sub-feature
import {
  CaseDeletionService,
  CaseRangeAutocompleteService,
  HistoryUserService,
  LookupUserService,
  ReasonUpdateService,
} from "./cases/application";
import { DrizzleUserLookupRepository } from "./cases/infrastructure/repositories/DrizzleUserLookupRepository";
import {
  HistoryCommand,
  LookupCommand,
  ReasonCommand,
  UncaseCommand,
  UserInfoContextMenuHandler,
} from "./cases/presentation";
// Tasks
import { TempbanTask } from "./infrastructure/tasks/TempbanTask";
// Management sub-feature
import {
  PruneMessageService,
  SlowmodeService,
  TempBanListService,
} from "./management/application";
import {
  PruneCommand,
  SlowmodeCommand,
  TempbanListCommand,
} from "./management/presentation";
// Shared components
import { DMNotificationService } from "./shared/application";
// Shared components
import { TimeoutDetectionService } from "./shared/domain/services/TimeoutDetectionService";
import {
  DiscordChannelService,
  DiscordModLogService,
  DiscordPermissionValidationService,
  DrizzleModLogRepository,
  DrizzleTempBanRepository,
} from "./shared/infrastructure";
import { COMMAND_CONFIGS, ReasonAutocomplete } from "./shared/presentation";

interface ModerationDependencies {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
}

interface ModerationTaskDependencies extends ModerationDependencies {
  deploymentService: DeploymentService;
}

export function createModerationServices({
  db,
  client,
  logger,
}: ModerationDependencies) {
  const modLogRepository = new DrizzleModLogRepository(
    db,
    logger.child({ module: "modLogRepository" }),
  );

  const guildConfigRepository = new DrizzleGuildConfigRepository(
    db,
    logger.child({ module: "guildConfigRepository" }),
  );

  const tempBanRepository = new DrizzleTempBanRepository(
    db,
    logger.child({ module: "tempBanRepository" }),
  );

  const dmPolicyService = new DMPolicyService(guildConfigRepository);
  const dmNotificationService = new DMNotificationService(
    logger.child({ module: "dmNotificationService" }),
  );

  const permissionService = new DiscordPermissionValidationService();
  const timeoutDetectionService = new TimeoutDetectionService();
  const modLogService = new DiscordModLogService(
    client,
    logger.child({ module: "modLogService" }),
  );

  // Create execution pipeline with focused dependencies
  const moderationExecutionPipeline = new ModerationExecutionPipeline(
    db,
    modLogRepository,
    tempBanRepository,
    modLogService,
    dmPolicyService,
    dmNotificationService,
    guildConfigRepository,
    client,
    logger.child({ module: "moderationExecutionPipeline" }),
  );

  const moderationService = new ModerationService(
    db,
    permissionService,
    timeoutDetectionService,
    moderationExecutionPipeline,
    logger.child({ module: "moderationService" }),
  );

  const userLookupRepository = new DrizzleUserLookupRepository(
    db,
    logger.child({ module: "userLookupRepository" }),
  );

  const lookupUserService = new LookupUserService(
    client,
    userLookupRepository,
    guildConfigRepository,
    logger.child({ module: "lookupUserService" }),
  );

  const historyUserService = new HistoryUserService(
    client,
    modLogRepository,
    logger.child({ module: "historyUserService" }),
  );

  const targetResolutionService = new TargetResolutionService();

  // New utility services
  const tempBanListService = new TempBanListService(
    tempBanRepository,
    logger.child({ module: "tempBanListService" }),
  );

  const channelService = new DiscordChannelService(
    client,
    logger.child({ module: "channelService" }),
  );

  const slowmodeService = new SlowmodeService(
    channelService,
    logger.child({ module: "slowmodeService" }),
  );

  const pruneMessageService = new PruneMessageService(
    client,
    logger.child({ module: "pruneMessageService" }),
  );

  const caseDeletionService = new CaseDeletionService(
    db,
    modLogRepository,
    guildConfigRepository,
    client,
    logger.child({ module: "caseDeletionService" }),
  );

  const reasonUpdateService = new ReasonUpdateService(
    modLogRepository,
    guildConfigRepository,
    client,
    logger.child({ module: "reasonUpdateService" }),
  );

  const caseRangeAutocompleteService = new CaseRangeAutocompleteService(
    modLogRepository,
    logger.child({ module: "caseRangeAutocompleteService" }),
  );

  // Audit log services
  const auditLogProcessingService = new AuditLogProcessingService(
    modLogRepository,
    guildConfigRepository,
    logger.child({ module: "auditLogProcessingService" }),
  );

  const nativeTimeoutDMService = new NativeTimeoutDMService(
    dmNotificationService,
    logger.child({ module: "nativeTimeoutDMService" }),
  );

  const modLogPostingService = new ModLogPostingService(
    logger.child({ module: "modLogPostingService" }),
  );

  const auditLogOrchestrationService = new AuditLogOrchestrationService(
    auditLogProcessingService,
    nativeTimeoutDMService,
    modLogPostingService,
    guildConfigRepository,
    logger.child({ module: "auditLogOrchestrationService" }),
  );

  const discordAuditLogService = new DiscordAuditLogService(
    auditLogOrchestrationService,
    logger.child({ module: "discordAuditLogService" }),
  );

  return {
    modLogRepository,
    guildConfigRepository,
    tempBanRepository,
    dmPolicyService,
    dmNotificationService,
    moderationService,
    lookupUserService,
    historyUserService,
    targetResolutionService,
    tempBanListService,
    channelService,
    slowmodeService,
    pruneMessageService,
    caseDeletionService,
    reasonUpdateService,
    caseRangeAutocompleteService,

    // Audit log services
    auditLogProcessingService,
    nativeTimeoutDMService,
    modLogPostingService,
    auditLogOrchestrationService,
    discordAuditLogService,
  };
}

export function createModerationCommands(
  services: ReturnType<typeof createModerationServices>,
  logger: Logger,
) {
  const {
    moderationService,
    lookupUserService,
    historyUserService,
    targetResolutionService,
    tempBanListService,
    slowmodeService,
    pruneMessageService,
    caseDeletionService,
    reasonUpdateService,
    caseRangeAutocompleteService,
    guildConfigRepository,
  } = services;

  // Iterate over all COMMAND_CONFIGS and build commands
  const commands: SlashCommandHandler[] = Object.values(COMMAND_CONFIGS).map(
    (config) => {
      return new ModerationCommand(
        config,
        moderationService,
        targetResolutionService,
        guildConfigRepository,
      );
    },
  );

  commands.push(
    new LookupCommand(
      lookupUserService,
      logger.child({ commandHandler: "lookup" }),
    ),
    new HistoryCommand(
      historyUserService,
      logger.child({ commandHandler: "history" }),
    ),
    // Utility commands
    new TempbanListCommand(
      tempBanListService,
      logger.child({ commandHandler: "tempban-list" }),
    ),
    new SlowmodeCommand(
      slowmodeService,
      logger.child({ commandHandler: "slowmode" }),
    ),
    new PruneCommand(
      pruneMessageService,
      logger.child({ commandHandler: "prune" }),
    ),
    new UncaseCommand(
      caseDeletionService,
      logger.child({ commandHandler: "uncase" }),
    ),
    new ReasonCommand(
      reasonUpdateService,
      logger.child({ commandHandler: "reason" }),
    ),
  );

  const autocompletes = [
    new ReasonAutocomplete(
      caseRangeAutocompleteService,
      logger.child({ autocompleteHandler: "reason" }),
    ),
  ];

  const contextMenuHandlers = [
    new UserInfoContextMenuHandler(
      historyUserService,
      lookupUserService,
      logger.child({ contextMenuHandler: "userInfoContextMenu" }),
    ),
  ];

  const buttonHandlers = [
    new ModLogReasonButtonHandler(
      services.modLogRepository,
      logger.child({ buttonHandler: "modLogReason" }),
    ),
    new ModLogDeleteDMButtonHandler(
      services.modLogRepository,
      logger.child({ buttonHandler: "modLogDeleteDM" }),
    ),
  ];

  return {
    commands,
    autocompletes,
    contextMenuHandlers,
    buttonHandlers,
  };
}

export function createModerationEventHandlers(
  services: ReturnType<typeof createModerationServices>,
  logger: Logger,
) {
  const { discordAuditLogService } = services;

  const auditLogEventHandler = new AuditLogEventHandler(
    discordAuditLogService,
    logger.child({ eventHandler: "auditLog" }),
  );

  return {
    eventHandlers: [auditLogEventHandler],
  };
}

export function createModerationTasks(
  services: ReturnType<typeof createModerationServices>,
  client: Client,
  deploymentService: DeploymentService,
) {
  const { tempBanRepository } = services;

  const tasks = [new TempbanTask(client, deploymentService, tempBanRepository)];

  return {
    tasks,
  };
}

export function setupModerationFeature({
  db,
  client,
  logger,
  deploymentService,
}: ModerationTaskDependencies): FullFeatureSetupReturn<
  ReturnType<typeof createModerationServices>
> {
  const services = createModerationServices({ db, client, logger });
  const commands = createModerationCommands(services, logger);
  const events = createModerationEventHandlers(services, logger);
  const tasks = createModerationTasks(services, client, deploymentService);

  return {
    services,
    commands: commands.commands,
    autocompletes: commands.autocompletes,
    contextMenuHandlers: commands.contextMenuHandlers,
    buttonHandlers: commands.buttonHandlers,
    eventHandlers: events.eventHandlers,
    tasks: tasks.tasks,
  };
}
