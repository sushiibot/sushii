import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";
import { REVIEW_CHANNEL_ID } from "../../constants";
import type { ScamHashReportService } from "../../application/ScamHashReportService";

export class ScamHashReportPostTask extends AbstractBackgroundTask {
  readonly name = "ScamHashReportPost";
  // Poll every 10 seconds using 6-field cron (seconds support in cron v4)
  readonly cronTime = "*/10 * * * * *";

  private isRunning = false;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly scamHashReportService: ScamHashReportService,
  ) {
    super(client, deploymentService, logger);
  }

  shouldRunOnCluster(): boolean {
    return this.client.channels.cache.has(REVIEW_CHANNEL_ID);
  }

  protected async execute(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const failures = await this.scamHashReportService.postPendingReports();
      for (const { reportId, error } of failures) {
        this.logger.error({ err: error, reportId }, "Failed to post pending scam hash report");
      }
    } finally {
      this.isRunning = false;
    }
  }
}
