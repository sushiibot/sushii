import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { GuildMember, Message } from "discord.js";

const tracer = opentelemetry.trace.getTracer("notifications");
import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
} from "discord.js";
import type { Logger } from "pino";

import type { Notification } from "../domain/entities/Notification";
import {
  DEFAULT_USER_NOTIFICATION_SETTINGS,
  type UserNotificationSettings,
} from "../domain/repositories/NotificationUserSettingsRepository";
import type { NotificationMetrics } from "../infrastructure/metrics/NotificationMetrics";
import { createNotificationEmbed } from "../presentation/views/NotificationEmbedView";
import type { NotificationService } from "./NotificationService";

export class NotificationMessageService {
  private readonly dmFailureCount = new Map<string, number>();
  private readonly MAX_DM_FAILURES = 3;

  constructor(
    private readonly notificationService: NotificationService,
    private readonly logger: Logger,
    private readonly notificationMetrics: NotificationMetrics,
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

    // Notifications matched — span covers delivery work only.
    await tracer.startActiveSpan("notifications.deliver", async (span) => {
      span.setAttributes({
        "guild.id": message.guildId,
        "channel.id": message.channelId,
        "channel.type": ChannelType[message.channel.type],
        ...(message.channel.parentId && { "channel.parent_id": message.channel.parentId }),
        "message.id": message.id,
        "author.id": message.author.id,
        "notification.matched_count": matchedNotifications.length,
      });
      try {
        const uniqueNotifications = this.deduplicateByUser(matchedNotifications);

        span.setAttributes({
          "notification.delivered_count": uniqueNotifications.length,
          "notification.keywords": [
            ...new Set(uniqueNotifications.map((n) => n.keyword)),
          ],
        });

        const userIds = uniqueNotifications.map((n) => n.userId);
        const settingsMap =
          await this.notificationService.getUserSettingsMap(userIds);

        // Pre-fetch thread members once to populate cache, avoiding N API calls
        // later when checking thread membership. Only fetch when needed:
        // - Private threads always require membership checks.
        // - Public threads only need it when at least one user has ignoreUnjoinedThreads on.
        const needsThreadMemberFetch =
          message.channel.isThread() &&
          (message.channel.type === ChannelType.PrivateThread ||
            [...settingsMap.values()].some((s) => s.ignoreUnjoinedThreads));

        span.setAttribute("notification.thread_member_fetch", needsThreadMemberFetch);

        if (needsThreadMemberFetch) {
          await message.channel.members.fetch();
        }

        await this.sendNotifications(message, uniqueNotifications, settingsMap);

        this.notificationMetrics.sentNotificationsCounter.add(1, {
          status: "success",
        });
      } catch (err) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err instanceof Error ? err.message : String(err),
        });
        throw err;
      } finally {
        span.end();
      }
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
    settingsMap: Map<string, UserNotificationSettings>,
  ): Promise<void> {
    for (const notification of notifications) {
      try {
        const settings =
          settingsMap.get(notification.userId) ??
          DEFAULT_USER_NOTIFICATION_SETTINGS;
        await this.sendNotificationToUser(message, notification, settings);
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
    settings: UserNotificationSettings,
  ): Promise<void> {
    let member: GuildMember;

    try {
      member = await message.guild.members.fetch(notification.userId);
    } catch (err) {
      await this.handleMemberNotFound(message, notification, err);
      return;
    }

    if (!(await this.canMemberViewChannel(message, member, settings))) {
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

      this.notificationMetrics.sentNotificationsCounter.add(1, {
        status: "success",
      });
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

    this.notificationMetrics.sentNotificationsCounter.add(1, {
      status: "failed",
    });

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

  private async canMemberViewChannel(
    message: Message,
    member: GuildMember,
    settings: UserNotificationSettings,
  ): Promise<boolean> {
    if (!message.inGuild()) {
      return false;
    }

    const memberPermissions = message.channel.permissionsFor(member);
    if (!memberPermissions?.has(PermissionFlagsBits.ViewChannel)) {
      return false;
    }

    // permissionsFor() on threads only checks the parent channel permissions,
    // not thread membership. Private thread members must be explicitly added.
    // Cache was pre-populated in processMessage, so this is a cache-only lookup.
    if (message.channel.type === ChannelType.PrivateThread) {
      return message.channel.members.cache.has(member.id);
    }

    // For public threads, optionally filter to only members who have joined.
    // Cache was pre-populated in processMessage for all thread types.
    if (message.channel.isThread() && settings.ignoreUnjoinedThreads) {
      return message.channel.members.cache.has(member.id);
    }

    return true;
  }
}
