import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { ScamCandidateService } from "../../application/ScamCandidateService";

export class ScamCandidateJanitorTask extends AbstractBackgroundTask {
  readonly name = "ScamCandidateJanitor";
  // Run every 5 minutes
  readonly cronTime = "*/5 * * * *";

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly scamCandidateService: ScamCandidateService,
  ) {
    super(client, deploymentService, logger);
  }

  protected async execute(): Promise<void> {
    await this.scamCandidateService.deleteOldSightings();
  }
}
