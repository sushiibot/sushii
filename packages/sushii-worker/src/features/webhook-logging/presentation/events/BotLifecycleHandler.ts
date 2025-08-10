import type { Client } from "discord.js";
import { Events } from "discord.js";

import { EventHandler } from "@/core/cluster/presentation/EventHandler";
import { config } from "@/shared/infrastructure/config";
import Color from "@/utils/colors";

import type { WebhookService } from "../../infrastructure/WebhookService";

export class BotLifecycleHandler extends EventHandler<Events.ClientReady> {
  readonly eventType = Events.ClientReady;

  constructor(private readonly webhookService: WebhookService) {
    super();
  }

  async handle(client: Client<true>): Promise<void> {
    let content =
      `Bot User: \`${client.user.tag}\`` +
      `\nShard IDs: \`${client.cluster.shardList.join(", ")}\`` +
      `\nGuilds: \`${client.guilds.cache.size}\`` +
      `\nDeployment: \`${config.deployment.name}\``;

    if (config.build.gitHash) {
      content += `\nBuild Git Hash: \`${config.build.gitHash}\``;
    }

    if (config.build.buildDate) {
      content += `\nBuild Date: <t:${config.build.buildDate.getTime() / 1000}>`;
    }

    await this.webhookService.logInfo(
      `[Cluster #${client.cluster.id}] Cluster ClientReady`,
      content,
      Color.Success,
    );
  }
}