import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { SushiiUpdatesRelayService } from "../../application/SushiiUpdatesRelayService";

/** Each cluster forwards to the guilds in its own cache; delivery rows are the claims, so two processes never send the same delivery. */
export class SushiiUpdatesRelayTask extends AbstractBackgroundTask {
  readonly name = "SushiiUpdatesRelay";
  readonly cronTime = "* * * * *";

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly sourceChannelId: string,
    private readonly relay: SushiiUpdatesRelayService,
  ) {
    super(client, deploymentService, logger);
  }

  shouldRunOnCluster(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    // Only the cluster that holds the support server does the global cleanup.
    if (this.client.channels.cache.has(this.sourceChannelId)) {
      try {
        await this.relay.housekeeping();
      } catch (err) {
        this.logger.error({ err }, "sushii updates cleanup failed");
      }
    }

    await this.relay.run({
      guildIds: () => [...this.client.guilds.cache.keys()],
      getGuild: (guildId) => this.client.guilds.cache.get(guildId),
      isActive: () => this.deploymentService.isCurrentDeploymentActive(),
    });
  }
}
