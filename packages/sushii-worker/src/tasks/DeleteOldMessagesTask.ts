import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import { deleteMessagesBefore } from "../db/Message/Message.repository";
import db from "../infrastructure/database/db";
import { AbstractBackgroundTask } from "./AbstractBackgroundTask";

const RETAIN_DURATION = dayjs.duration({
  days: 7,
});

export class DeleteOldMessagesTask extends AbstractBackgroundTask {
  readonly name = "Delete messages older than 7 days";
  readonly cronTime = "0 0 * * *"; // Once a day

  constructor(client: Client, deploymentService: DeploymentService) {
    super(client, deploymentService, newModuleLogger("DeleteOldMessagesTask"));
  }

  protected async execute(): Promise<void> {
    const res = await deleteMessagesBefore(
      db,
      dayjs().utc().subtract(RETAIN_DURATION).toDate(),
    );

    this.logger.info(
      {
        deleteCount: res.numDeletedRows,
      },
      "Deleted old messages",
    );
  }
}
