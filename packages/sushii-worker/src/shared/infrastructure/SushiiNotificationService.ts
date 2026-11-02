import {
  type Client,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import Color from "@/utils/colors";

export interface SushiiNotification {
  title: string;
  body: string;
  hint?: string;
  severity: "info" | "warning";
}

/**
 * Posts sushii's own messages to a guild's "sushii notifications" channel.
 * Best-effort: nothing is sent when the channel isn't set or is unusable.
 */
export class SushiiNotificationService {
  constructor(
    private readonly client: Client,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly logger: Logger,
  ) {}

  async notify(
    guildId: string,
    notification: SushiiNotification,
  ): Promise<boolean> {
    const config = await this.guildConfigRepository.findByGuildId(guildId);
    const { sushiiNotificationsChannel, sushiiNotificationsEnabled } =
      config.loggingSettings;
    if (!sushiiNotificationsChannel || !sushiiNotificationsEnabled) {
      return false;
    }

    const channel = this.client.channels.cache.get(sushiiNotificationsChannel);
    if (!channel || !channel.isSendable()) {
      return false;
    }

    try {
      await channel.send({
        components: [buildNotificationContainer(notification)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      });
      return true;
    } catch (err) {
      this.logger.warn(
        { err, guildId, channelId: sushiiNotificationsChannel },
        "Failed to send sushii notification",
      );
      return false;
    }
  }
}

export function buildNotificationContainer(
  notification: SushiiNotification,
): ContainerBuilder {
  const container = new ContainerBuilder()
    .setAccentColor(
      notification.severity === "warning" ? Color.Warning : Color.Info,
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `### ${notification.title}\n${notification.body}`,
      ),
    );

  if (notification.hint) {
    container
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`-# ${notification.hint}`),
      );
  }

  return container;
}
