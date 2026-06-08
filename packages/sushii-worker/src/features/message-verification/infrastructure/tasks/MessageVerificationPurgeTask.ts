import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { MessageVerificationService } from "../../application/MessageVerificationService";

export class MessageVerificationPurgeTask extends AbstractBackgroundTask {
  readonly name = "Purge expired message verification records";
  readonly cronTime = "0 * * * *"; // Every hour

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly messageVerificationService: MessageVerificationService,
  ) {
    super(client, deploymentService, newModuleLogger("MessageVerificationPurgeTask"));
  }

  protected async execute(): Promise<void> {
    const deletedCount = await this.messageVerificationService.deleteExpired();

    this.logger.info(
      { deletedCount },
      "Purged expired message verification records",
    );
  }
}
