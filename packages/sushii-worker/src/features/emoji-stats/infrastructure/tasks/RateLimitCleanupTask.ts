import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import { USER_EMOJI_RATE_LIMIT_DURATION } from "../../domain/constants";
import type { RateLimitRepository } from "../../domain/repositories";

export class RateLimitCleanupTask extends AbstractBackgroundTask {
  readonly name = "Emoji Stats Rate Limit Cleanup";
  readonly cronTime = "0 0 * * *"; // Once a day at midnight

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private rateLimitRepository: RateLimitRepository,
  ) {
    super(client, deploymentService, newModuleLogger("RateLimitCleanupTask"));
  }

  protected async execute(): Promise<void> {
    const cutoffDate = dayjs()
      .utc()
      .subtract(USER_EMOJI_RATE_LIMIT_DURATION)
      .toDate();

    this.logger.debug({ cutoffDate }, "Starting rate limit cleanup");

    const deletedCount =
      await this.rateLimitRepository.deleteExpiredRateLimits(cutoffDate);

    this.logger.info(
      { deletedCount, cutoffDate },
      "Completed rate limit cleanup",
    );
  }
}
