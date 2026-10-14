import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { PermissionUsageRepository } from "../../domain/PermissionUsageRepository";

/** Audit window is 45 days; the extra margin keeps the window complete between prunes. */
const RETENTION_DAYS = 60;

export class PermissionUsagePruneTask extends AbstractBackgroundTask {
  readonly name = "Permission Usage Prune";
  readonly cronTime = "30 0 * * *";

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly repository: PermissionUsageRepository,
  ) {
    super(
      client,
      deploymentService,
      newModuleLogger("PermissionUsagePruneTask"),
    );
  }

  protected async execute(): Promise<void> {
    const cutoff = dayjs().utc().subtract(RETENTION_DAYS, "day").toDate();
    const deletedCount = await this.repository.deleteLastUsedBefore(cutoff);

    this.logger.info({ deletedCount, cutoff }, "Pruned permission usage");
  }
}
