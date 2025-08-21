import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { MessageLogEventRepository } from "../../domain/repositories/MessageLogEventRepository";

const RETAIN_DURATION = dayjs.duration({
  days: 7,
});

export class DeleteOldMessagesTask extends AbstractBackgroundTask {
  readonly name = "Delete messages older than 7 days";
  readonly cronTime = "0 0 * * *"; // Once a day

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly messageLogEventRepository: MessageLogEventRepository,
  ) {
    super(client, deploymentService, newModuleLogger("DeleteOldMessagesTask"));
  }

  protected async execute(): Promise<void> {
    const cutoffDate = dayjs().utc().subtract(RETAIN_DURATION).toDate();

    const deleteCount =
      await this.messageLogEventRepository.deleteMessagesBefore(cutoffDate);

    this.logger.info(
      {
        deleteCount,
        cutoffDate,
      },
      "Deleted old messages",
    );
  }
}
