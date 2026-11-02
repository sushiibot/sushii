import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { IpGrabberSyncService } from "../../application/IpGrabberSyncService";
import type { IpGrabberRepository } from "../../domain/IpGrabberRepository";

/**
 * Keeps each configured rule on this cluster in step with the domain list.
 * Guilds whose keywords already match are skipped without a Discord call.
 */
export class IpGrabberSyncTask extends AbstractBackgroundTask {
  readonly name = "IpGrabberSync";
  readonly cronTime = "*/5 * * * *";

  private isRunning = false;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly repository: IpGrabberRepository,
    private readonly syncService: IpGrabberSyncService,
  ) {
    super(client, deploymentService, logger);
  }

  shouldRunOnCluster(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    try {
      const settings = (await this.repository.listConfiguredSettings()).filter(
        (s) => this.client.guilds.cache.has(s.guildId),
      );
      if (settings.length === 0) {
        return;
      }

      const catalog = await this.syncService.loadCatalog();
      for (const { guildId } of settings) {
        try {
          await this.syncService.syncGuild(guildId, { catalog });
        } catch (err) {
          this.logger.error(
            { err, guildId },
            "IP grabber sync failed for guild",
          );
        }
      }
    } finally {
      this.isRunning = false;
    }
  }
}
