import type { Client } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import { guildGauge, membersGauge } from "@/infrastructure/metrics/metrics";
import logger from "@/shared/infrastructure/logger";
import { newModuleLogger } from "@/shared/infrastructure/logger";

import db from "../infrastructure/database/db";
import { AbstractBackgroundTask } from "./AbstractBackgroundTask";

export enum StatName {
  GuildCount = "guild_count",
  // Should actually be user count
  MemberCount = "member_count",
  CommandCount = "command_count",
}

export async function updateStat(
  name: StatName,
  value: number,
  action: "set" | "add",
): Promise<void> {
  logger.info(
    {
      stat: name,
      value,
      action,
    },
    "Updating bot stat",
  );

  if (action === "add") {
    await db
      .insertInto("app_public.bot_stats")
      .values({
        name,
        category: "bot",
        count: value,
      })
      .onConflict((oc) =>
        oc.columns(["name", "category"]).doUpdateSet({
          count: (eb) =>
            eb("app_public.bot_stats.count", "+", value.toString()),
        }),
      )
      .execute();
  } else {
    await db
      .insertInto("app_public.bot_stats")
      .values({
        name,
        category: "bot",
        count: value,
      })
      .onConflict((oc) =>
        oc.columns(["name", "category"]).doUpdateSet({
          count: value,
        }),
      )
      .execute();
  }
}

export class StatsTask extends AbstractBackgroundTask {
  readonly name = "Update bot stats in db";
  readonly cronTime = "*/10 * * * *"; // Cron every 10 minutes

  constructor(client: Client, deploymentService: DeploymentService) {
    super(client, deploymentService, newModuleLogger("StatsTask"));
  }

  protected async execute(): Promise<void> {
    // Get all shard data
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

    await updateStat(StatName.GuildCount, totalGuilds, "set");
    await updateStat(StatName.MemberCount, totalMembers, "set");

    // Set prometheus metrics
    guildGauge.set(this.client.guilds.cache.size);
    membersGauge.set(totalMembers);
  }
}
