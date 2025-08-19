import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import {
  guildGauge,
  membersGauge,
} from "@/shared/infrastructure/opentelemetry/metrics/feature";
import { AbstractBackgroundTask } from "@/tasks/AbstractBackgroundTask";

import type { StatsService } from "../../application/StatsService";
import { StatName } from "../../domain/StatName";

export class StatsTask extends AbstractBackgroundTask {
  readonly name = "Update bot stats in db";
  readonly cronTime = "*/10 * * * *";

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly statsService: StatsService,
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

    guildGauge.record(totalGuilds);
    membersGauge.record(totalMembers);
  }
}
