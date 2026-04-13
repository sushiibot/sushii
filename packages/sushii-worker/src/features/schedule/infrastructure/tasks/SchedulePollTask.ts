import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { SchedulePollService } from "../../application/SchedulePollService";

export class SchedulePollTask extends AbstractBackgroundTask {
  readonly name = "Schedule channel poll";
  readonly cronTime = "* * * * *"; // Every minute

  private isProcessing = false;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly schedulePollService: SchedulePollService,
  ) {
    super(client, deploymentService, logger);
  }

  protected async execute(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug("Skipping schedule poll - previous run still in progress");
      return;
    }

    try {
      this.isProcessing = true;
      await this.schedulePollService.pollAll();
    } finally {
      this.isProcessing = false;
    }
  }
}
