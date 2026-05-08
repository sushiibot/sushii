import type { SQL } from "drizzle-orm";
import type { Client } from "discord.js";
import type { Logger } from "pino";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { DrizzleDB } from "../UserLevelRepository";

export class GlobalLeaderboardRefreshTask extends AbstractBackgroundTask {
  readonly name: string;
  readonly cronTime: string;
  readonly runOnInit = true;

  private isRefreshing = false;

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    logger: Logger,
    private readonly db: DrizzleDB,
    private readonly refreshSql: SQL,
    taskName: string,
    cronTime: string,
  ) {
    super(client, deploymentService, logger);
    this.name = taskName;
    this.cronTime = cronTime;
  }

  protected async execute(): Promise<void> {
    if (this.isRefreshing) {
      this.logger.debug(
        { taskName: this.name },
        "Skipping global leaderboard refresh — previous run still in progress",
      );
      return;
    }

    try {
      this.isRefreshing = true;
      await this.db.execute(this.refreshSql);
      this.logger.info({ taskName: this.name }, "Refreshed global leaderboard view");
    } finally {
      this.isRefreshing = false;
    }
  }
}
