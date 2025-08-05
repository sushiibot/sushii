import { EmbedBuilder, WebhookClient } from "discord.js";

import { config } from "@/shared/infrastructure/config";
import logger from "@/shared/infrastructure/logger";
import Color from "@/utils/colors";

const webhookClientLog = config.notifications.webhookUrl
  ? new WebhookClient({
      url: config.notifications.webhookUrl,
    })
  : null;

const webhookClientErr = config.notifications.errorWebhookUrl
  ? new WebhookClient({
      url: config.notifications.errorWebhookUrl,
    })
  : null;

const webhookClientActivity = config.notifications.activityWebhookUrl
  ? new WebhookClient({
      url: config.notifications.activityWebhookUrl,
    })
  : null;

export default async function webhookLog(
  title: string,
  message: string,
  color?: number,
): Promise<void> {
  if (!webhookClientLog) {
    logger.warn("No webhook client, skipping webhook log");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(message || "No message")
    .setColor(color || null)
    .setTimestamp(new Date());

  try {
    await webhookClientLog.send({
      username: config.notifications.webhookUsername || "sushii",
      embeds: [embed],
    });

    logger.debug({ title, message }, "Sent webhook log");
  } catch (err) {
    logger.error({ err }, "Failed to send webhook log");
  }
}

export async function webhookErr(
  title: string,
  message: string,
): Promise<void> {
  if (!webhookClientErr) {
    logger.warn("No webhook client, skipping webhook log");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(message || "No message")
    .setColor(Color.Error)
    .setTimestamp(new Date());

  try {
    await webhookClientErr.send({
      username: config.notifications.webhookUsername || "sushii",
      embeds: [embed],
    });

    logger.debug({ title, message }, "Sent webhook log");
  } catch (err) {
    logger.error({ err }, "Failed to send webhook log");
  }
}

export async function webhookActivity(
  title: string,
  message: string,
  color?: number,
): Promise<void> {
  if (!webhookClientActivity) {
    logger.warn("No activity webhook client, skipping activity webhook log");
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(message || "No message")
    .setColor(color || null)
    .setTimestamp(new Date());

  try {
    await webhookClientActivity.send({
      username: config.notifications.webhookUsername || "sushii",
      embeds: [embed],
    });

    logger.debug({ title, message }, "Sent activity webhook log");
  } catch (err) {
    logger.error({ err }, "Failed to send activity webhook log");
  }
}
