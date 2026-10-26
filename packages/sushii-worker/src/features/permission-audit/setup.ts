import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { PermissionAuditService } from "./application/PermissionAuditService";
import { PermissionChangeService } from "./application/PermissionChangeService";
import { PermissionUsageRecorder } from "./application/PermissionUsageRecorder";
import { AuditLogUsageDetector } from "./domain/detectors/AuditLogUsageDetector";
import { MessageUsageDetector } from "./domain/detectors/MessageUsageDetector";
import { AuditLogBackfillService } from "./infrastructure/AuditLogBackfillService";
import { DiscordAuditMemberSource } from "./infrastructure/DiscordAuditMemberSource";
import { DrizzlePermissionAuditReadRepository } from "./infrastructure/DrizzlePermissionAuditReadRepository";
import { DrizzlePermissionUsageCoverageRepository } from "./infrastructure/DrizzlePermissionUsageCoverageRepository";
import { DrizzlePermissionUsageRepository } from "./infrastructure/DrizzlePermissionUsageRepository";
import { PermissionUsagePruneTask } from "./infrastructure/tasks/PermissionUsagePruneTask";
import { PermissionAuditCommand } from "./presentation/commands/PermissionAuditCommand";
import { AuditLogUsageHandler } from "./presentation/events/AuditLogUsageHandler";
import { GuildDeleteUsageHandler } from "./presentation/events/GuildDeleteUsageHandler";
import { MessageUsageHandler } from "./presentation/events/MessageUsageHandler";

export interface PermissionAuditFeatureDependencies {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
  deploymentService: DeploymentService;
  emojiRepository: BotEmojiRepository;
}

interface PermissionAuditServices {
  permissionUsageRecorder: PermissionUsageRecorder;
}

export function setupPermissionAuditFeature({
  db,
  client,
  logger,
  deploymentService,
  emojiRepository,
}: PermissionAuditFeatureDependencies): FullFeatureSetupReturn<PermissionAuditServices> {
  const repository = new DrizzlePermissionUsageRepository(db);

  const auditLogDetector = new AuditLogUsageDetector(() => client.user?.id);
  const messageDetector = new MessageUsageDetector();

  const permissionUsageRecorder = new PermissionUsageRecorder(
    repository,
    auditLogDetector,
    messageDetector,
    logger,
  );

  const coverageRepository = new DrizzlePermissionUsageCoverageRepository(db);
  const auditService = new PermissionAuditService(
    new DrizzlePermissionAuditReadRepository(db),
    coverageRepository,
    new AuditLogBackfillService(
      coverageRepository,
      permissionUsageRecorder,
      logger,
    ),
    new DiscordAuditMemberSource(logger),
    new Set(auditLogDetector.observes),
    new Set(messageDetector.observes),
  );

  return {
    services: { permissionUsageRecorder },
    commands: [
      new PermissionAuditCommand(
        auditService,
        new PermissionChangeService(logger),
        logger,
        emojiRepository,
      ),
    ],
    autocompletes: [],
    contextMenuHandlers: [],
    buttonHandlers: [],
    eventHandlers: [
      new AuditLogUsageHandler(permissionUsageRecorder),
      new MessageUsageHandler(permissionUsageRecorder, deploymentService),
      new GuildDeleteUsageHandler(permissionUsageRecorder, logger),
    ],
    tasks: [
      new PermissionUsagePruneTask(client, deploymentService, repository),
    ],
  };
}
