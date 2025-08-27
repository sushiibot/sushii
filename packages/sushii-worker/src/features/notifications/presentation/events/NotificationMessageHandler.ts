import type { Message } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";

import type { NotificationMessageService } from "../../application/NotificationMessageService";
import type { NotificationService } from "../../application/NotificationService";
import type { NotificationMetrics } from "../../infrastructure/metrics/NotificationMetrics";

export class NotificationMessageHandler extends EventHandler<Events.MessageCreate> {
  constructor(
    private readonly messageService: NotificationMessageService,
    private readonly notificationService: NotificationService,
    private readonly notificationMetrics: NotificationMetrics,
  ) {
    super();
  }

  readonly eventType = Events.MessageCreate;

  async handle(...data: [Message]): Promise<void> {
    const [message] = data;
    if (!message.inGuild() || message.author.bot || !message.content) {
      return;
    }

    try {
      await this.messageService.processMessage(message);
    } catch (error) {
      this.notificationMetrics.sentNotificationsCounter.add(1, {
        status: "failed",
      });

      throw error;
    }

    const totalActiveKeywords =
      await this.notificationService.getTotalNotificationCount();

    this.notificationMetrics.activeNotificationsGauge.record(
      totalActiveKeywords,
    );
  }
}
