import type { Guild } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import Color from "@/utils/colors";

import type { WebhookService } from "../../infrastructure/WebhookService";

export class GuildLeaveHandler extends EventHandler<Events.GuildDelete> {
  readonly eventType = Events.GuildDelete;

  constructor(private readonly webhookService: WebhookService) {
    super();
  }

  async handle(guild: Guild): Promise<void> {
    await this.webhookService.logActivity(
      "Left guild",
      `${guild.name} (${guild.id}) - ${guild.memberCount} members`,
      Color.Error,
    );
  }
}