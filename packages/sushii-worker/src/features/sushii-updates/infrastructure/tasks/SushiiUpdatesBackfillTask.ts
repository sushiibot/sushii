import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { SushiiUpdatesBackfillService } from "../../application/SushiiUpdatesBackfillService";

/**
 * Runs on start and then hourly: a new blue/green slot starts inactive, so a
 * ready-only run would always be skipped.
 */
export class SushiiUpdatesBackfillTask extends AbstractBackgroundTask {
  readonly name = "SushiiUpdatesBackfill";
  readonly cronTime = "17 * * * *";
  override readonly runOnInit = true;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly backfill: SushiiUpdatesBackfillService,
  ) {
    super(client, deploymentService, logger);
  }

  shouldRunOnCluster(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    await this.backfill.run({
      getGuild: (guildId) => this.client.guilds.cache.get(guildId),
      isActive: () => this.deploymentService.isCurrentDeploymentActive(),
    });
  }
}
