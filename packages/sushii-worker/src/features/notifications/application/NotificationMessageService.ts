import type { GuildMember, Message } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";

import { sentNotificationsCounter } from "@/infrastructure/metrics/metrics";

import type { Notification } from "../domain/entities/Notification";
import { createNotificationEmbed } from "../presentation/views/NotificationEmbedView";
import type { NotificationService } from "./NotificationService";

export class NotificationMessageService {
  private readonly dmFailureCount = new Map<string, number>();
  private readonly MAX_DM_FAILURES = 3;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly logger: Logger,
  ) {}

  async processMessage(message: Message): Promise<void> {
    if (!message.inGuild() || message.author.bot || !message.content) {
      return;
    }

    const matchedNotifications =
      await this.notificationService.findMatchingNotifications(
        message.guildId,
        message.channel.parentId,
        message.channelId,
        message.author.id,
        message.content,
      );

    if (matchedNotifications.length === 0) {
      return;
    }

    const uniqueNotifications = this.deduplicateByUser(matchedNotifications);
    await this.sendNotifications(message, uniqueNotifications);

    sentNotificationsCounter.inc({
      status: "success",
    });
  }

  private deduplicateByUser(notifications: Notification[]): Notification[] {
    const seenUserIds = new Set<string>();
    return notifications.filter((notification) => {
      if (seenUserIds.has(notification.userId)) {
        return false;
      }
      seenUserIds.add(notification.userId);
      return true;
    });
  }

  private async sendNotifications(
    message: Message<true>,
    notifications: Notification[],
  ): Promise<void> {
    for (const notification of notifications) {
      try {
        await this.sendNotificationToUser(message, notification);
      } catch (error) {
        this.logger.error(
          { error, guildId: message.guildId, userId: notification.userId },
          "Failed to send notification to user",
        );
      }
    }
  }

  private async sendNotificationToUser(
    message: Message<true>,
    notification: Notification,
  ): Promise<void> {
    let member: GuildMember;

    try {
      member = await message.guild.members.fetch(notification.userId);
    } catch (err) {
      await this.handleMemberNotFound(message, notification, err);
      return;
    }

    if (!this.canMemberViewChannel(message, member)) {
      this.logger.debug(
        {
          guildId: message.guildId,
          userId: member.id,
          channelId: message.channelId,
        },
        "Member cannot view channel, skipping notification",
      );
      return;
    }

    const embed = createNotificationEmbed(message, notification);

    try {
      await member.send({ embeds: [embed] });

      // Reset failure count on successful send
      this.dmFailureCount.delete(notification.userId);

      this.logger.debug(
        { userId: notification.userId, keyword: notification.keyword },
        "Sent notification",
      );

      sentNotificationsCounter.inc({ status: "success" });
    } catch (error) {
      await this.handleDmFailure(notification, error);
    }
  }

  private async handleDmFailure(
    notification: Notification,
    error: unknown,
  ): Promise<void> {
    const currentFailures = this.dmFailureCount.get(notification.userId) || 0;
    const newFailureCount = currentFailures + 1;

    this.dmFailureCount.set(notification.userId, newFailureCount);

    sentNotificationsCounter.inc({ status: "failed" });

    this.logger.debug(
      {
        userId: notification.userId,
        failureCount: newFailureCount,
        failureMapSize: this.dmFailureCount.size,
        error,
      },
      "Failed to send DM notification",
    );

    if (newFailureCount >= this.MAX_DM_FAILURES) {
      this.logger.info(
        {
          userId: notification.userId,
          guildId: notification.guildId,
          failureCount: newFailureCount,
        },
        "Deleting all notifications for user due to repeated DM failures",
      );

      await this.notificationService.cleanupMemberLeft(
        notification.guildId,
        notification.userId,
      );

      // Reset failure count after cleanup
      this.dmFailureCount.delete(notification.userId);
    }
  }

  private async handleMemberNotFound(
    message: Message,
    notification: Notification,
    err: unknown,
  ): Promise<void> {
    if (err instanceof DiscordAPIError) {
      if (err.code === RESTJSONErrorCodes.UnknownMember) {
        this.logger.debug(
          { guildId: message.guildId, userId: notification.userId },
          "Member left guild, cleaning up notification",
        );

        await this.notificationService.cleanupMemberLeft(
          notification.guildId,
          notification.userId,
        );
        return;
      }
    }

    this.logger.debug(
      {
        err,
        guildId: message.guildId,
        userId: notification.userId,
      },
      "Member not found, skipping notification",
    );
  }

  private canMemberViewChannel(message: Message, member: GuildMember): boolean {
    if (!message.inGuild()) {
      return false;
    }

    const memberPermissions = message.channel.permissionsFor(member);
    return memberPermissions?.has("ViewChannel") ?? false;
  }
}
