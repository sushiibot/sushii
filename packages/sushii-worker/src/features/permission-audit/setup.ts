import type { Client } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type * as schema from "@/infrastructure/database/schema";
import type { FullFeatureSetupReturn } from "@/shared/types/FeatureSetup";

import { PermissionUsageRecorder } from "./application/PermissionUsageRecorder";
import { AuditLogUsageDetector } from "./domain/detectors/AuditLogUsageDetector";
import { MessageUsageDetector } from "./domain/detectors/MessageUsageDetector";
import { DrizzlePermissionUsageRepository } from "./infrastructure/DrizzlePermissionUsageRepository";
import { PermissionUsagePruneTask } from "./infrastructure/tasks/PermissionUsagePruneTask";
import { AuditLogUsageHandler } from "./presentation/events/AuditLogUsageHandler";
import { GuildDeleteUsageHandler } from "./presentation/events/GuildDeleteUsageHandler";
import { MessageUsageHandler } from "./presentation/events/MessageUsageHandler";

export interface PermissionAuditFeatureDependencies {
  db: NodePgDatabase<typeof schema>;
  client: Client;
  logger: Logger;
  deploymentService: DeploymentService;
}

interface PermissionAuditServices {
  permissionUsageRecorder: PermissionUsageRecorder;
}

export function setupPermissionAuditFeature({
  db,
  client,
  logger,
  deploymentService,
}: PermissionAuditFeatureDependencies): FullFeatureSetupReturn<PermissionAuditServices> {
  const repository = new DrizzlePermissionUsageRepository(db);

  const permissionUsageRecorder = new PermissionUsageRecorder(
    repository,
    new AuditLogUsageDetector(() => client.user?.id),
    new MessageUsageDetector(),
    logger,
  );

  return {
    services: { permissionUsageRecorder },
    commands: [],
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
