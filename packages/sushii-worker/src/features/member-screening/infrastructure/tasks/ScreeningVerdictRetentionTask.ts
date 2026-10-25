import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { ScreeningVerdictRepository } from "../../domain/repositories/ScreeningVerdictRepository";
import { VERDICT_RETENTION_DAYS } from "../../domain/types";

export class ScreeningVerdictRetentionTask extends AbstractBackgroundTask {
  readonly name = `Delete screening verdicts older than ${VERDICT_RETENTION_DAYS} days`;
  readonly cronTime = "30 0 * * *";

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly verdictRepo: ScreeningVerdictRepository,
  ) {
    super(
      client,
      deploymentService,
      newModuleLogger("ScreeningVerdictRetentionTask"),
    );
  }

  protected async execute(): Promise<void> {
    const cutoffDate = dayjs()
      .utc()
      .subtract(VERDICT_RETENTION_DAYS, "day")
      .toDate();

    const deleteCount = await this.verdictRepo.deleteOlderThan(cutoffDate);

    this.logger.info(
      { deleteCount, cutoffDate },
      "Deleted old screening verdicts",
    );
  }
}
