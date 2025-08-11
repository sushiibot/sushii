import { EmbedBuilder, WebhookClient } from "discord.js";
import type { Logger } from "pino";

import { config } from "@/shared/infrastructure/config";

export class WebhookService {
  private readonly webhookClientLog: WebhookClient | null;
  private readonly webhookClientActivity: WebhookClient | null;
  private readonly webhookClientError: WebhookClient | null;

  constructor(private readonly logger: Logger) {
    this.webhookClientLog = config.notifications.webhookUrl
      ? new WebhookClient({ url: config.notifications.webhookUrl })
      : null;

    this.webhookClientActivity = config.notifications.activityWebhookUrl
      ? new WebhookClient({ url: config.notifications.activityWebhookUrl })
      : null;

    this.webhookClientError = config.notifications.errorWebhookUrl
      ? new WebhookClient({ url: config.notifications.errorWebhookUrl })
      : null;
  }

  async logInfo(title: string, message: string, color?: number): Promise<void> {
    if (!this.webhookClientLog) {
      this.logger.warn("No webhook client, skipping webhook log");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message || "No message")
      .setColor(color || null)
      .setTimestamp(new Date());

    try {
      await this.webhookClientLog.send({
        username: config.notifications.webhookUsername || "sushii",
        embeds: [embed],
      });

      this.logger.debug({ title, message }, "Sent webhook log");
    } catch (err) {
      this.logger.error({ err }, "Failed to send webhook log");
    }
  }

  async logActivity(
    title: string,
    message: string,
    color?: number,
  ): Promise<void> {
    if (!this.webhookClientActivity) {
      this.logger.warn(
        "No activity webhook client, skipping activity webhook log",
      );
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message || "No message")
      .setColor(color || null)
      .setTimestamp(new Date());

    try {
      await this.webhookClientActivity.send({
        username: config.notifications.webhookUsername || "sushii",
        embeds: [embed],
      });

      this.logger.debug({ title, message }, "Sent activity webhook log");
    } catch (err) {
      this.logger.error({ err }, "Failed to send activity webhook log");
    }
  }

  async logError(title: string, message: string): Promise<void> {
    if (!this.webhookClientError) {
      this.logger.warn("No webhook client, skipping webhook log");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message || "No message")
      .setColor(0xff0000) // Red color for errors
      .setTimestamp(new Date());

    try {
      await this.webhookClientError.send({
        username: config.notifications.webhookUsername || "sushii",
        embeds: [embed],
      });

      this.logger.debug({ title, message }, "Sent webhook log");
    } catch (err) {
      this.logger.error({ err }, "Failed to send webhook log");
    }
  }
}
