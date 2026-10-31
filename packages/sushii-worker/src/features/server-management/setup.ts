import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import type { PermissionUsageRecorder } from "@/features/permission-audit";
import type * as schema from "@/infrastructure/database/schema";
import type { CommandMentions } from "@/shared/presentation/commandMentions";

import { ServerAppearanceService } from "./application/ServerAppearanceService";
import { DrizzleServerNameSnapshotRepository } from "./infrastructure/DrizzleServerNameSnapshotRepository";
import { ServerCommand } from "./presentation/commands/ServerCommand";

interface SetupParams {
  db: NodePgDatabase<typeof schema>;
  permissionUsageRecorder: PermissionUsageRecorder;
  commandMentions: CommandMentions;
  logger: Logger;
}

export function setupServerManagementFeature({
  db,
  permissionUsageRecorder,
  commandMentions,
  logger,
}: SetupParams) {
  const featureLogger = logger.child({ component: "ServerManagement" });
  const appearanceService = new ServerAppearanceService(
    new DrizzleServerNameSnapshotRepository(db),
    featureLogger,
  );

  return {
    commands: [
      new ServerCommand(
        appearanceService,
        permissionUsageRecorder,
        commandMentions,
        featureLogger,
      ),
    ],
  };
}
