import type { Guild } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import Color from "@/utils/colors";

import type { WebhookService } from "../../infrastructure/WebhookService";

export class GuildLeaveHandler extends EventHandler<Events.GuildDelete> {
  readonly eventType = Events.GuildDelete;

  constructor(
    private readonly webhookService: WebhookService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handle(guild: Guild): Promise<void> {
    // Regular application logging
    this.logger.info(
      {
        guildId: guild.id,
      },
      "Removed guild %s",
      guild.name,
    );

    // Webhook notification
    await this.webhookService.logActivity(
      "Left guild",
      `${guild.name} (${guild.id}) - ${guild.memberCount} members`,
      Color.Error,
    );
  }
}
