import type { Client } from "discord.js";
import type { Logger } from "pino";

import { REVIEW_CHANNEL_ID } from "@/features/automod/constants";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { IpGrabberReviewService } from "../../application/IpGrabberReviewService";

export class IpGrabberReviewPostTask extends AbstractBackgroundTask {
  readonly name = "IpGrabberReviewPost";
  readonly cronTime = "*/30 * * * * *";

  private isRunning = false;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly reviewService: IpGrabberReviewService,
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
      await this.reviewService.postPendingReviews();
    } finally {
      this.isRunning = false;
    }
  }
}
