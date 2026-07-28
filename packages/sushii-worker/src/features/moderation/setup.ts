import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { SetNicknameService } from "@/features/alt-accounts/application/SetNicknameService";
import type { AltAccountRepository } from "@/features/alt-accounts/domain/repositories";
import type { AutomodAlertReactionService } from "@/features/automod/application/AutomodAlertReactionService";
import type { SpamAlertUpdateService } from "@/features/automod/application/SpamAlertUpdateService";
import type { BotEmojiRepository } from "@/features/bot-emojis";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { UserLevelRepository } from "@/features/leveling/domain/repositories/UserLevelRepository";
import type { UserNameHistoryService } from "@/features/user-name-history";
import type * as schema from "@/infrastructure/database/schema";
import { DrizzleGuildConfigRepository } from "@/shared/infrastructure/DrizzleGuildConfigRepository";
import type { SlashCommandHandler } from "@/shared/presentation/handlers";
import type ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

// Actions sub-feature
import {
  DMPolicyService,
  ModerationExecutionPipeline,
  ModerationService,
  TargetResolutionService,
} from "./actions/application";
import { ModerationCommand } from "./actions/presentation";
import { AutomodAlertActionButtonHandler } from "./actions/presentation/components/AutomodAlertActionButtonHandler";
import { AutomodAlertRemoveTimeoutButtonHandler } from "./actions/presentation/components/AutomodAlertRemoveTimeoutButtonHandler";
import { AuditLogEventHandler } from "./audit-logs";
// Audit logs sub-feature
import {
  AuditLogService,
  ModLogPostingService,
  NativeTimeoutDMService,
} from "./audit-logs/application";
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
  NamesUserService,
  ReasonUpdateService,
} from "./cases/application";
import { DrizzleUserLookupRepository } from "./cases/infrastructure/repositories/DrizzleUserLookupRepository";
import {
  HistoryCommand,
  LookupCommand,
  NamesCommand,
  ReasonCommand,
  UncaseCommand,
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
// Mod view sub-feature
import type { ModViewDependencies } from "./mod-view/presentation/ModViewEntry";
import {
  createModViewDependencies,
  setupModViewFeature,
} from "./mod-view/setup";
// Shared components
import { DMNotificationService } from "./shared/application";
import { SoftbanSuppressionSet } from "./shared/application/SoftbanSuppressionSet";
// Shared components
import { TimeoutDetectionService } from "./shared/domain/services/TimeoutDetectionService";
import {
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
  emojiRepository: BotEmojiRepository;
  automodAlertReactionService: AutomodAlertReactionService;
  spamAlertUpdateService: SpamAlertUpdateService;
  nameHistoryService: UserNameHistoryService;
  userLevelRepository: UserLevelRepository;
  altAccountRepository: AltAccountRepository;
  setNicknameService: SetNicknameService;
}

interface ModerationTaskDependencies extends ModerationDependencies {
  deploymentService: DeploymentService;
}

export function createModerationServices({
  db,
  client,
  logger,
  emojiRepository,
  automodAlertReactionService,
  spamAlertUpdateService,
  nameHistoryService,
  altAccountRepository,
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

  const softbanSuppressionSet = new SoftbanSuppressionSet();

  const permissionService = new DiscordPermissionValidationService();
  const timeoutDetectionService = new TimeoutDetectionService();
  const modLogService = new DiscordModLogService(
    client,
    guildConfigRepository,
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
    softbanSuppressionSet,
  );

  const moderationService = new ModerationService(
    db,
    permissionService,
    timeoutDetectionService,
    moderationExecutionPipeline,
    guildConfigRepository,
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
    altAccountRepository,
    logger.child({ module: "historyUserService" }),
  );

  const namesUserService = new NamesUserService(
    client,
    nameHistoryService,
    modLogRepository,
    logger.child({ module: "namesUserService" }),
  );

  const targetResolutionService = new TargetResolutionService();

  // New utility services
  const tempBanListService = new TempBanListService(
    tempBanRepository,
    logger.child({ module: "tempBanListService" }),
  );

  const slowmodeService = new SlowmodeService(
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
  const nativeTimeoutDMService = new NativeTimeoutDMService(
    dmNotificationService,
    logger.child({ module: "nativeTimeoutDMService" }),
  );

  const modLogPostingService = new ModLogPostingService(
    logger.child({ module: "modLogPostingService" }),
  );

  const auditLogService = new AuditLogService(
    modLogRepository,
    nativeTimeoutDMService,
    modLogPostingService,
    guildConfigRepository,
    automodAlertReactionService,
    spamAlertUpdateService,
    logger.child({ module: "auditLogService" }),
    softbanSuppressionSet,
  );

  return {
    modLogRepository,
    guildConfigRepository,
    tempBanRepository,
    timeoutDetectionService,
    dmPolicyService,
    dmNotificationService,
    moderationService,
    lookupUserService,
    historyUserService,
    namesUserService,
    targetResolutionService,
    tempBanListService,
    slowmodeService,
    pruneMessageService,
    caseDeletionService,
    reasonUpdateService,
    caseRangeAutocompleteService,

    // Audit log services
    auditLogService,
    nativeTimeoutDMService,
    modLogPostingService,

    // Additional dependencies
    emojiRepository,
  };
}

export function createModerationCommands(
  services: ReturnType<typeof createModerationServices>,
  logger: Logger,
  modViewDependencies: ModViewDependencies,
) {
  const {
    moderationService,
    targetResolutionService,
    tempBanListService,
    slowmodeService,
    pruneMessageService,
    caseDeletionService,
    reasonUpdateService,
    caseRangeAutocompleteService,
    guildConfigRepository,
    emojiRepository,
  } = services;

  // Iterate over all COMMAND_CONFIGS and build commands
  const commands: SlashCommandHandler[] = Object.values(COMMAND_CONFIGS).map(
    (config) => {
      return new ModerationCommand(
        config,
        moderationService,
        targetResolutionService,
        guildConfigRepository,
        emojiRepository,
      );
    },
  );

  commands.push(
    new LookupCommand(
      modViewDependencies,
      logger.child({ commandHandler: "lookup" }),
    ),
    new HistoryCommand(
      modViewDependencies,
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
    new NamesCommand(
      modViewDependencies,
      logger.child({ commandHandler: "names" }),
    ),
  );

  const autocompletes = [
    new ReasonAutocomplete(
      caseRangeAutocompleteService,
      logger.child({ autocompleteHandler: "reason" }),
    ),
  ];

  const contextMenuHandlers: ContextMenuHandler[] = [];

  const buttonHandlers = [
    new ModLogReasonButtonHandler(
      services.modLogRepository,
      logger.child({ buttonHandler: "modLogReason" }),
    ),
    new ModLogDeleteDMButtonHandler(
      services.modLogRepository,
      logger.child({ buttonHandler: "modLogDeleteDM" }),
    ),
    new AutomodAlertActionButtonHandler(
      moderationService,
      logger.child({ buttonHandler: "automodAlertAction" }),
    ),
    new AutomodAlertRemoveTimeoutButtonHandler(
      moderationService,
      logger.child({ buttonHandler: "automodAlertRemoveTimeout" }),
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
  const { auditLogService } = services;

  const auditLogEventHandler = new AuditLogEventHandler(
    auditLogService,
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
  emojiRepository,
  automodAlertReactionService,
  spamAlertUpdateService,
  nameHistoryService,
  userLevelRepository,
  altAccountRepository,
  setNicknameService,
}: ModerationTaskDependencies): FullFeatureSetupReturn<
  ReturnType<typeof createModerationServices> & {
    modViewDependencies: ModViewDependencies;
  }
> {
  const services = createModerationServices({
    db,
    client,
    logger,
    emojiRepository,
    automodAlertReactionService,
    spamAlertUpdateService,
    nameHistoryService,
    userLevelRepository,
    altAccountRepository,
    setNicknameService,
  });

  // Built ahead of both createModerationCommands (History/Names/Lookup
  // deep-link into it) and setupModViewFeature (which registers /modview and
  // the context menu on top of the same instance).
  const modViewDependencies = createModViewDependencies({
    client,
    logger: logger.child({ feature: "ModView" }),
    emojiRepository,
    historyUserService: services.historyUserService,
    lookupUserService: services.lookupUserService,
    namesUserService: services.namesUserService,
    altAccountRepository,
    tempBanRepository: services.tempBanRepository,
    timeoutDetectionService: services.timeoutDetectionService,
    setNicknameService,
  });

  const commands = createModerationCommands(
    services,
    logger,
    modViewDependencies,
  );
  const events = createModerationEventHandlers(services, logger);
  const tasks = createModerationTasks(services, client, deploymentService);

  // Sub-feature: the mod view fans out over the per-user services above, so it
  // is constructed here rather than from the cluster bootstrap.
  const modView = setupModViewFeature({
    modViewDependencies,
  });

  return {
    services: { ...services, modViewDependencies },
    commands: [...commands.commands, ...modView.commands],
    autocompletes: commands.autocompletes,
    contextMenuHandlers: [
      ...commands.contextMenuHandlers,
      ...modView.contextMenuHandlers,
    ],
    buttonHandlers: commands.buttonHandlers,
    eventHandlers: events.eventHandlers,
    tasks: tasks.tasks,
  };
}
