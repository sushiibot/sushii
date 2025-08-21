import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { ReminderService } from "../application/ReminderService";
import type { ReminderMetrics } from "./metrics/ReminderMetrics";

export class ReminderBackgroundTask extends AbstractBackgroundTask {
  readonly name = "Check for expired reminders";
  readonly cronTime = "*/30 * * * * *"; // Every 30 seconds

  private isProcessing = false;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly reminderService: ReminderService,
    private readonly metrics: ReminderMetrics,
  ) {
    super(client, deploymentService, logger);
  }

  protected async execute(): Promise<void> {
    if (this.isProcessing) {
      this.logger.debug(
        "Skipping reminder processing - previous run still in progress",
      );
      return;
    }

    try {
      this.isProcessing = true;
      const { sent, failed } =
        await this.reminderService.processExpiredReminders();

      // Update metrics
      this.metrics.sentRemindersCounter.add(sent, { status: "success" });
      this.metrics.sentRemindersCounter.add(failed, { status: "failed" });

      const pendingCount = await this.reminderService.countPendingReminders();
      this.metrics.pendingRemindersGauge.record(pendingCount);
    } finally {
      this.isProcessing = false;
    }
  }
}
