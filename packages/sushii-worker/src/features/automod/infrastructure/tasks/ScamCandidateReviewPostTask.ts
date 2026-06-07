import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";
import { REVIEW_CHANNEL_ID } from "../../constants";
import type { ScamCandidateService } from "../../application/ScamCandidateService";

export class ScamCandidateReviewPostTask extends AbstractBackgroundTask {
  readonly name = "ScamCandidateReviewPost";
  // Poll every 10 seconds using 6-field cron (seconds support in cron v4)
  readonly cronTime = "*/10 * * * * *";

  private isRunning = false;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly scamCandidateService: ScamCandidateService,
  ) {
    super(client, deploymentService, logger);
  }

  shouldRunOnCluster(client: Client): boolean {
    return client.channels.cache.has(REVIEW_CHANNEL_ID);
  }

  protected async execute(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      await this.scamCandidateService.postPendingReviews();
    } finally {
      this.isRunning = false;
    }
  }
}
