import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { ReactionStarterRepository } from "../../domain/repositories/ReactionStarterRepository";

export class ReactionStarterCleanupTask extends AbstractBackgroundTask {
  readonly name = "ReactionStarterCleanup";
  readonly cronTime = "0 2 * * *"; // Run daily at 2 AM

  private readonly CLEANUP_DAYS = 30; // Keep data for 30 days

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly reactionStarterRepository: ReactionStarterRepository,
  ) {
    super(client, deploymentService, logger);
  }

  protected async execute(): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.CLEANUP_DAYS);

      this.logger.info(
        { cutoffDate, cleanupDays: this.CLEANUP_DAYS },
        "Starting reaction starter cleanup",
      );

      const deletedCount =
        await this.reactionStarterRepository.deleteOldStarters(cutoffDate);

      this.logger.info(
        { deletedCount, cutoffDate },
        "Completed reaction starter cleanup",
      );
    } catch (err) {
      this.logger.error({ err }, "Failed to execute reaction starter cleanup");
    }
  }
}
