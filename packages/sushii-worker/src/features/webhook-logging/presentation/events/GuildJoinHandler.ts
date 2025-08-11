import type { Guild } from "discord.js";
import { Events } from "discord.js";
import type { Logger } from "pino";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import Color from "@/utils/colors";

import type { WebhookService } from "../../infrastructure/WebhookService";

export class GuildJoinHandler extends EventHandler<Events.GuildCreate> {
  readonly eventType = Events.GuildCreate;

  constructor(
    private readonly webhookService: WebhookService,
    private readonly logger: Logger,
    private readonly deploymentService: DeploymentService,
  ) {
    super();
  }

  async handle(guild: Guild): Promise<void> {
    // Regular application logging
    this.logger.info(
      {
        guildId: guild.id,
      },
      "Joined guild %s",
      guild.name,
    );

    // Only send webhook notifications if deployment is active
    if (!this.deploymentService.isCurrentDeploymentActive()) {
      return;
    }

    // Webhook notification
    await this.webhookService.logActivity(
      "Joined guild",
      `${guild.name} (${guild.id}) - ${guild.memberCount} members`,
      Color.Info,
    );
  }
}
