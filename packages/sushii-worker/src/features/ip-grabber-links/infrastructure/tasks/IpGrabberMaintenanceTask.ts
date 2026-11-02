import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { IpGrabberMaintenanceService } from "../../application/IpGrabberMaintenanceService";

/** Global list upkeep, so it runs on cluster 0 only. */
export class IpGrabberMaintenanceTask extends AbstractBackgroundTask {
  readonly name = "IpGrabberMaintenance";
  readonly cronTime = "17 5 * * *";

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly maintenanceService: IpGrabberMaintenanceService,
  ) {
    super(client, deploymentService, logger);
  }

  protected async execute(): Promise<void> {
    await this.maintenanceService.recheckDomains();
    await this.maintenanceService.refreshFromEndpoint();
  }
}
