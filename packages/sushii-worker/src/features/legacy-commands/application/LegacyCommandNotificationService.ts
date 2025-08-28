import type { User } from "discord.js";
import type { Logger } from "pino";

import type {
  LegacyCommand,
  LegacyCommandNotification,
  LegacyCommandNotificationRepository,
} from "../domain";
import { LegacyCommandNotification as LegacyCommandNotificationEntity } from "../domain";

export class LegacyCommandNotificationService {
  constructor(
    private readonly notificationRepository: LegacyCommandNotificationRepository,
    private readonly logger: Logger,
  ) {}

  async shouldSendNotification(userId: string): Promise<boolean> {
    const notification = await this.notificationRepository.findByUserId(userId);

    if (!notification) {
      // User has never been notified
      return true;
    }

    return notification.canSendNotification();
  }

  async recordNotification(userId: string): Promise<void> {
    const existingNotification =
      await this.notificationRepository.findByUserId(userId);

    let notification: LegacyCommandNotification;
    if (existingNotification) {
      notification = existingNotification.withNewNotification();
    } else {
      notification = new LegacyCommandNotificationEntity(userId, new Date(), 1);
    }

    await this.notificationRepository.save(notification);

    this.logger.info(
      { userId, dmCount: notification.dmCount },
      "Recorded legacy command notification",
    );
  }

  async sendLegacyCommandDm(
    user: User,
    legacyCommand: LegacyCommand,
    dmMessagePayload: object,
  ): Promise<boolean> {
    try {
      await user.send(dmMessagePayload);
      this.logger.info(
        { userId: user.id, command: legacyCommand.name },
        "Sent legacy command migration DM",
      );
      return true;
    } catch (error) {
      this.logger.warn(
        {
          err: error,
          userId: user.id,
          command: legacyCommand.name,
        },
        "Failed to send legacy command migration DM",
      );
      return false;
    }
  }
}
