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
import type { PermissionUsageRecorder } from "@/features/permission-audit";
import type { ProductEventTracker } from "@/features/product-analytics/domain/ProductEvent";
import type { UserNameHistoryService } from "@/features/user-name-history";
import type * as schema from "@/infrastructure/database/schema";
import { DrizzleGuildConfigRepository } from "@/shared/infrastructure/DrizzleGuildConfigRepository";
import type { SelectMenuHandler } from "@/shared/presentation/handlers";
import type ContextMenuHandler from "@/shared/presentation/handlers/ContextMenuHandler";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

// Actions sub-feature
import {
  DMPolicyService,
  ModerationExecutionPipeline,
  ModerationService,
  TargetResolutionService,
} from "./actions/application";
import { createActionResponseHandlers } from "./actions/presentation/actionResponseFactory";
import { AutomodAlertRemoveTimeoutButtonHandler } from "./actions/presentation/components/AutomodAlertRemoveTimeoutButtonHandler";
import { actionResponseRegistry } from "./actions/presentation/response/responseRegistry";
import { AuditLogEventHandler } from "./audit-logs";
// Audit logs sub-feature
import {
  AuditLogService,
  ModLogPostingService,
  NativeTimeoutDMService,
} from "./audit-logs/application";
// Cases sub-feature
import {
  CaseDeletionService,
  CaseRangeAutocompleteService,
  HistoryUserService,
  LookupUserService,
  NamesUserService,
  ReasonUpdateService,
} from "./cases/application";
import { CaseProofService } from "./cases/application/CaseProofService";
import { DrizzleUserLookupRepository } from "./cases/infrastructure/repositories/DrizzleUserLookupRepository";
import {
  HistoryCommand,
  LookupCommand,
  NamesCommand,
  UncaseCommand,
} from "./cases/presentation";
import { AddAsProofContextMenuHandler } from "./cases/presentation/commands/AddAsProofContextMenuHandler";
import {
  ProofCaseAutocomplete,
  ProofCommand,
} from "./cases/presentation/commands/ProofCommand";
import {
  AddAsProofButtonHandler,
  type AddAsProofDeps,
  AddAsProofSelectHandler,
  AddAsProofUndoButtonHandler,
} from "./cases/presentation/components/AddAsProofHandlers";
import { AddProofButtonHandler } from "./cases/presentation/components/AddProofButtonHandler";
import { createReasonEditingHandlers } from "./cases/presentation/reasonEditingFactory";
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
import { createModViewRegistry } from "./mod-view/presentation/modViewRegistry";
import {
  createModViewDependencies,
  setupModViewFeature,
} from "./mod-view/setup";
import { OtelProofSuggestionMetrics } from "./proof-suggestions/infrastructure/OtelProofSuggestionMetrics";
import { ProductProofSuggestionMetrics } from "./proof-suggestions/infrastructure/ProductProofSuggestionMetrics";
import type { SuggestionPreviewRenderer } from "./proof-suggestions/infrastructure/preview/types";
import { ProofSuggestionButtonHandler } from "./proof-suggestions/presentation/ProofSuggestionButtonHandler";
import { ProofSuggestionSelectHandler } from "./proof-suggestions/presentation/ProofSuggestionSelectHandler";
import { SuggestionFlow } from "./proof-suggestions/presentation/SuggestionFlow";
import { createModLogSuggestionOffer } from "./proof-suggestions/presentation/modLogSuggestionOffer";
import { createProofSuggestionServices } from "./proof-suggestions/setup";
// Reason templates sub-feature
import { ReasonTemplateService } from "./reason-templates/application/ReasonTemplateService";
import { DrizzleReasonTemplateRepository } from "./reason-templates/infrastructure/DrizzleReasonTemplateRepository";
import { createReasonTemplateHandlers } from "./reason-templates/presentation/factory";
// Shared components
import { DMNotificationService } from "./shared/application";
import { CaseDmDeletionService } from "./shared/application/CaseDmDeletionService";
import { ModLogMessageService } from "./shared/application/ModLogMessageService";
import { SoftbanSuppressionSet } from "./shared/application/SoftbanSuppressionSet";
// Shared components
import { TimeoutDetectionService } from "./shared/domain/services/TimeoutDetectionService";
import {
  DiscordModLogService,
  DiscordPermissionValidationService,
  DrizzleCaseProofRepository,
  DrizzleModLogRepository,
  DrizzleTempBanRepository,
} from "./shared/infrastructure";
import { OtelModerationMetrics } from "./shared/infrastructure/metrics/OtelModerationMetrics";
import { ReasonTemplateStatsGauge } from "./shared/infrastructure/metrics/ReasonTemplateStatsGauge";
import type { PromptOffer } from "./shared/presentation/proof/proofIntroOffer";

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
  permissionUsageRecorder: PermissionUsageRecorder;
  promptOffer: PromptOffer;
  productEvents: ProductEventTracker;
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
  permissionUsageRecorder,
  promptOffer,
  productEvents,
}: ModerationDependencies) {
  const { proofSuggestionService } = createProofSuggestionServices({
    db,
    client,
    logger,
  });

  const modLogRepository = new DrizzleModLogRepository(
    db,
    logger.child({ module: "modLogRepository" }),
  );

  const caseProofRepository = new DrizzleCaseProofRepository(db);

  // Built here, after the OTel SDK registers; an earlier meter stays a no-op.
  const moderationMetrics = new OtelModerationMetrics();

  const reasonTemplateRepository = new DrizzleReasonTemplateRepository(db);
  const reasonTemplateService = new ReasonTemplateService(
    reasonTemplateRepository,
    modLogRepository,
    moderationMetrics,
  );
  const reasonTemplateStatsGauge = new ReasonTemplateStatsGauge(
    reasonTemplateRepository,
    logger.child({ module: "reasonTemplateStatsGauge" }),
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
  const modLogMessageService = new ModLogMessageService(
    client,
    guildConfigRepository,
    emojiRepository,
    modLogRepository,
    caseProofRepository,
    logger.child({ module: "modLogMessageService" }),
    moderationMetrics,
    undefined,
    createModLogSuggestionOffer({
      caseProofRepository,
      suggestions: proofSuggestionService,
    }),
  );

  const caseDmDeletionService = new CaseDmDeletionService(
    client,
    modLogRepository,
    dmNotificationService,
    modLogMessageService,
    logger.child({ module: "caseDmDeletionService" }),
    moderationMetrics,
  );

  const modLogService = new DiscordModLogService(
    client,
    guildConfigRepository,
    modLogMessageService,
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
    permissionUsageRecorder,
    modLogMessageService,
    caseProofRepository,
    moderationMetrics,
    productEvents,
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
    dmNotificationService,
    modLogMessageService,
    logger.child({ module: "reasonUpdateService" }),
    moderationMetrics,
  );

  const modViewRegistry = createModViewRegistry({
    caseProofRepository,
    logger: logger.child({ module: "modViewRegistry" }),
  });

  const caseProofService = new CaseProofService({
    modLogRepository,
    caseProofRepository,
    modLogMessageService,
    responseRegistry: actionResponseRegistry,
    proofChangeListener: modViewRegistry,
    metrics: moderationMetrics,
    productEvents,
    logger: logger.child({ module: "caseProofService" }),
  });

  // Loaded on first use, so the native canvas module never loads unless a preview renders.
  let previewRenderer: Promise<SuggestionPreviewRenderer> | null = null;
  const suggestionFlow = new SuggestionFlow({
    caseProofRepository,
    suggestions: proofSuggestionService,
    renderer: {
      render: async (request) => {
        previewRenderer ??= import(
          "./proof-suggestions/infrastructure/preview/CanvasPreviewRenderer"
        ).then((m) => m.createSuggestionPreviewRenderer(client));
        return (await previewRenderer).render(request);
      },
    },
    caseProofService,
    modLogRepository,
    metrics: new ProductProofSuggestionMetrics(
      new OtelProofSuggestionMetrics(),
      productEvents,
      logger,
    ),
    logger: logger.child({ module: "proofSuggestions" }),
  });

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
    modLogMessageService,
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
    modLogMessageService,
  );

  return {
    modLogRepository,
    caseProofRepository,
    caseProofService,
    suggestionFlow,
    modViewRegistry,
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
    modLogMessageService,
    caseDmDeletionService,
    reasonTemplateRepository,
    reasonTemplateService,
    moderationMetrics,
    reasonTemplateStatsGauge,

    // Audit log services
    auditLogService,
    nativeTimeoutDMService,
    modLogPostingService,

    // Additional dependencies
    emojiRepository,
    permissionUsageRecorder,
    promptOffer,
  };
}

export type ModerationServices = ReturnType<typeof createModerationServices>;

export function createModerationCommands(
  services: ModerationServices,
  logger: Logger,
  modViewDependencies: ModViewDependencies,
) {
  const {
    moderationService,
    tempBanListService,
    slowmodeService,
    pruneMessageService,
    caseDeletionService,
    permissionUsageRecorder,
  } = services;

  const actionResponse = createActionResponseHandlers(services, logger);
  const reasonEditing = createReasonEditingHandlers(services, logger);
  const reasonTemplates = createReasonTemplateHandlers(services, logger);

  const commands = [
    ...actionResponse.commands,
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
      permissionUsageRecorder,
      logger.child({ commandHandler: "slowmode" }),
    ),
    new PruneCommand(
      pruneMessageService,
      permissionUsageRecorder,
      logger.child({ commandHandler: "prune" }),
    ),
    new UncaseCommand(
      caseDeletionService,
      logger.child({ commandHandler: "uncase" }),
    ),
    ...reasonEditing.commands,
    new NamesCommand(
      modViewDependencies,
      logger.child({ commandHandler: "names" }),
    ),
    ...reasonTemplates.commands,
    new ProofCommand({
      modLogRepository: services.modLogRepository,
      caseProofRepository: services.caseProofRepository,
      guildConfigRepository: services.guildConfigRepository,
      caseProofService: services.caseProofService,
      emojiRepository: services.emojiRepository,
      promptOffer: services.promptOffer,
      logger: logger.child({ commandHandler: "proof" }),
    }),
  ];

  const autocompletes = [
    ...reasonTemplates.autocompletes,
    new ProofCaseAutocomplete({
      modLogRepository: services.modLogRepository,
      logger: logger.child({ autocompleteHandler: "proof" }),
    }),
  ];

  const addAsProof: AddAsProofDeps = {
    modLogRepository: services.modLogRepository,
    guildConfigRepository: services.guildConfigRepository,
    caseProofService: services.caseProofService,
    emojiRepository: services.emojiRepository,
    promptOffer: services.promptOffer,
    logger: logger.child({ module: "addAsProof" }),
  };

  const contextMenuHandlers: ContextMenuHandler[] = [
    new AddAsProofContextMenuHandler(addAsProof),
  ];

  const selectMenuHandlers: SelectMenuHandler[] = [
    new AddAsProofSelectHandler(addAsProof),
    new ProofSuggestionSelectHandler(),
  ];

  const responseRefresh = {
    modLogRepository: services.modLogRepository,
    caseProofRepository: services.caseProofRepository,
    guildConfigRepository: services.guildConfigRepository,
    emojiRepository: services.emojiRepository,
  };

  const buttonHandlers = [
    ...reasonEditing.buttonHandlers,
    new AutomodAlertRemoveTimeoutButtonHandler(
      moderationService,
      logger.child({ buttonHandler: "automodAlertRemoveTimeout" }),
    ),
    ...actionResponse.buttonHandlers,
    new AddProofButtonHandler({
      ...responseRefresh,
      caseProofService: services.caseProofService,
      promptOffer: services.promptOffer,
      suggestionFlow: services.suggestionFlow,
      logger: logger.child({ buttonHandler: "addProof" }),
    }),
    new ProofSuggestionButtonHandler({
      flow: services.suggestionFlow,
      response: responseRefresh,
    }),
    new AddAsProofButtonHandler(addAsProof),
    new AddAsProofUndoButtonHandler(addAsProof),
    ...reasonTemplates.buttonHandlers,
  ];

  return {
    commands,
    autocompletes,
    contextMenuHandlers,
    buttonHandlers,
    selectMenuHandlers,
  };
}

export function createModerationEventHandlers(
  services: ModerationServices,
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
  services: ModerationServices,
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
  permissionUsageRecorder,
  promptOffer,
  productEvents,
}: ModerationTaskDependencies): FullFeatureSetupReturn<
  ReturnType<typeof createModerationServices> & {
    modViewDependencies: ModViewDependencies;
  }
> & { selectMenuHandlers: SelectMenuHandler[] } {
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
    permissionUsageRecorder,
    promptOffer,
    productEvents,
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
    caseProofRepository: services.caseProofRepository,
    guildConfigRepository: services.guildConfigRepository,
    modViewRegistry: services.modViewRegistry,
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
    selectMenuHandlers: commands.selectMenuHandlers,
    eventHandlers: events.eventHandlers,
    tasks: tasks.tasks,
  };
}
