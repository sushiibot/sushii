import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";

export abstract class AbstractBackgroundTask {
  abstract readonly name: string;
  abstract readonly cronTime: string;
  readonly runOnInit: boolean = false;

  constructor(
    protected readonly client: Client,
    protected readonly deploymentService: DeploymentService,
    protected readonly logger: Logger,
  ) {}

  /**
   * Optional predicate evaluated after the Discord `ready` event. When defined,
   * the task is registered on all clusters and the cron starts only if this returns
   * true. When absent, the existing cluster-0-only behaviour applies.
   */
  shouldRunOnCluster?(): boolean;

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
