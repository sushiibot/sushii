import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";

export abstract class AbstractBackgroundTask {
  abstract readonly name: string;
  abstract readonly cronTime: string;

  constructor(
    protected readonly client: Client,
    protected readonly deploymentService: DeploymentService,
    protected readonly logger: Logger,
  ) {}

  async onTick(): Promise<void> {
    // Check deployment status before executing
    if (!this.deploymentService.isCurrentDeploymentActive()) {
      this.logger.debug(
        {
          taskName: this.name,
          currentDeployment: this.deploymentService.getCurrentDeployment(),
        },
        "Skipping task execution - deployment not active",
      );

      return;
    }

    await this.execute();
  }

  protected abstract execute(): Promise<void>;
}
