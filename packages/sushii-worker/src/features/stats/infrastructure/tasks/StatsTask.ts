import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { StatsService } from "../../application/StatsService";
import { StatName } from "../../domain/StatName";
import type { StatsMetrics } from "../metrics/StatsMetrics";

export class StatsTask extends AbstractBackgroundTask {
  readonly name = "Update bot stats in db";
  readonly cronTime = "*/10 * * * *";

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly statsService: StatsService,
    private readonly statsMetrics: StatsMetrics,
  ) {
    super(client, deploymentService, newModuleLogger("StatsTask"));
  }

  protected async execute(): Promise<void> {
    const shardData = await this.client.cluster.broadcastEval((client) => ({
      guildCount: client.guilds.cache.size,
      memberCount: client.guilds.cache.reduce(
        (acc, guild) => acc + guild.memberCount,
        0,
      ),
    }));

    const totalGuilds =
      shardData?.reduce((acc, data) => acc + (data.guildCount ?? 0), 0) ?? 0;
    const totalMembers =
      shardData?.reduce((acc, data) => acc + (data.memberCount ?? 0), 0) ?? 0;

    await this.statsService.updateStat(StatName.GuildCount, totalGuilds, "set");
    await this.statsService.updateStat(
      StatName.MemberCount,
      totalMembers,
      "set",
    );

    this.statsMetrics.guildGauge.record(totalGuilds);
    this.statsMetrics.membersGauge.record(totalMembers);
  }
}
