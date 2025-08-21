import type { Client } from "discord.js";
import { EmbedBuilder } from "discord.js";
import type { Logger } from "pino";
import type { Result } from "ts-results";
import { Err, Ok } from "ts-results";

import dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";
import toTimestamp from "@/utils/toTimestamp";

import type { Reminder, ReminderData } from "../domain/entities/Reminder";
import { Reminder as ReminderEntity } from "../domain/entities/Reminder";
import type { ReminderRepository } from "../domain/repositories/ReminderRepository";

export interface CreateReminderParams {
  userId: string;
  description: string;
  expireAt: Date;
}

export class ReminderService {
  constructor(
    private readonly reminderRepository: ReminderRepository,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  async createReminder(
    params: CreateReminderParams,
  ): Promise<Result<Reminder, string>> {
    this.logger.debug({ params }, "Creating new reminder");

    const existingReminders = await this.reminderRepository.findByUserId(
      params.userId,
    );
    const nextId = this.getNextUserReminderId(existingReminders);

    const reminderData: ReminderData = {
      id: nextId,
      userId: params.userId,
      description: params.description,
      setAt: new Date(),
      expireAt: params.expireAt,
    };

    const reminderResult = ReminderEntity.create(reminderData);
    if (reminderResult.err) {
      return Err(reminderResult.val);
    }

    const reminder = reminderResult.val;
    await this.reminderRepository.save(reminder);

    this.logger.info(
      { userId: params.userId, reminderId: reminder.getId() },
      "Reminder created successfully",
    );

    return Ok(reminder);
  }

  async listUserReminders(userId: string): Promise<Reminder[]> {
    return this.reminderRepository.findByUserId(userId);
  }

  async deleteReminder(
    userId: string,
    reminderId: string,
  ): Promise<Result<Reminder | null, string>> {
    this.logger.debug({ userId, reminderId }, "Deleting reminder");

    const deletedReminder = await this.reminderRepository.deleteByUserIdAndId(
      userId,
      reminderId,
    );

    if (!deletedReminder) {
      return Err(
        "Reminder not found or you don't have permission to delete it",
      );
    }

    this.logger.info({ userId, reminderId }, "Reminder deleted successfully");

    return Ok(deletedReminder);
  }

  async getRemindersForAutocomplete(
    userId: string,
    query: string,
  ): Promise<Reminder[]> {
    return this.reminderRepository.findForAutocomplete(userId, query);
  }

  async processExpiredReminders(): Promise<{ sent: number; failed: number }> {
    const expiredReminders = await this.reminderRepository.deleteExpired();

    this.logger.info(
      { expiredReminders: expiredReminders.length },
      "Processing expired reminders",
    );

    let numSuccess = 0;
    let numFailed = 0;

    for (const reminder of expiredReminders) {
      try {
        const success = await this.sendReminderNotification(reminder);
        if (success) {
          numSuccess += 1;
        } else {
          numFailed += 1;
        }
      } catch (err) {
        this.logger.error(
          { err, userId: reminder.getUserId(), reminderId: reminder.getId() },
          "Failed to send reminder notification",
        );
        numFailed += 1;
      }
    }

    this.logger.info(
      { sent: numSuccess, failed: numFailed },
      "Finished processing expired reminders",
    );

    return { sent: numSuccess, failed: numFailed };
  }

  async countPendingReminders(): Promise<number> {
    return this.reminderRepository.countPending();
  }

  private async sendReminderNotification(reminder: Reminder): Promise<boolean> {
    try {
      const user = await this.client.users.fetch(reminder.getUserId());

      const embed = new EmbedBuilder()
        .setTitle(
          `Reminder expired from ${toTimestamp(dayjs.utc(reminder.getExpireAt()))}`,
        )
        .setDescription(reminder.getDescription() || "No description.")
        .setColor(Color.Info);

      await user.send({
        embeds: [embed],
      });

      return true;
    } catch (err) {
      this.logger.debug(
        { err, userId: reminder.getUserId(), reminderId: reminder.getId() },
        "Failed to send reminder DM - user may have DMs disabled",
      );
      return false;
    }
  }

  private getNextUserReminderId(existingReminders: Reminder[]): string {
    if (existingReminders.length === 0) {
      return "1";
    }

    const maxId = existingReminders
      .map((r) => parseInt(r.getId(), 10))
      .filter((id) => !isNaN(id))
      .reduce((max, current) => Math.max(max, current), 0);

    return (maxId + 1).toString();
  }
}
