import type { Client } from "discord.js";
import { EmbedBuilder } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import dayjs from "@/shared/domain/dayjs";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import {
  pendingRemindersGauge,
  sentRemindersCounter,
} from "@/shared/infrastructure/opentelemetry/metrics/legacy-reminders";

import {
  countAllPendingReminders,
  getAndDeleteExpiredReminders,
} from "../db/Reminder/Reminder.repository";
import db from "../infrastructure/database/db";
import Color from "../utils/colors";
import toTimestamp from "../utils/toTimestamp";
import { AbstractBackgroundTask } from "./AbstractBackgroundTask";

export class RemindersTask extends AbstractBackgroundTask {
  readonly name = "Check for expired reminders";
  readonly cronTime = "*/30 * * * * *"; // Every 30 seconds

  constructor(client: Client, deploymentService: DeploymentService) {
    super(client, deploymentService, newModuleLogger("RemindersTask"));
  }

  protected async execute(): Promise<void> {
    const expiredReminders = await getAndDeleteExpiredReminders(db);

    this.logger.info(
      {
        expiredReminders: expiredReminders.length,
      },
      "checking and deleting expired reminders",
    );

    let numSuccess = 0;
    let numFailed = 0;

    for (const reminder of expiredReminders) {
      try {
        const user = await this.client.users.fetch(reminder.user_id);

        const embed = new EmbedBuilder()
          .setTitle(
            `Reminder expired from ${toTimestamp(dayjs.utc(reminder.expire_at))}`,
          )
          .setDescription(reminder.description || "No description.")
          .setColor(Color.Info);

        await user.send({
          embeds: [embed],
        });

        numSuccess += 1;
      } catch {
        // Might fail if the user has DMs disabled, no retries
        numFailed += 1;
        continue;
      }
    }

    sentRemindersCounter.add(numSuccess, {
      status: "success",
    });

    sentRemindersCounter.add(numFailed, {
      status: "failed",
    });

    const pendingReminderCount = await countAllPendingReminders(db);
    pendingRemindersGauge.record(pendingReminderCount);
  }
}
