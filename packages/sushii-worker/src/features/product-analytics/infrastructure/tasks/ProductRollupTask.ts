import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { ProductRollupService } from "../../application/ProductRollupService";

export class ProductRollupTask extends AbstractBackgroundTask {
  readonly name = "Roll up and expire product events";
  readonly cronTime = "15 1 * * *";

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly rollupService: ProductRollupService,
  ) {
    super(client, deploymentService, newModuleLogger("ProductRollupTask"));
  }

  protected execute(): Promise<void> {
    return this.rollupService.run(new Date());
  }
}
