import type { Client } from "discord.js";
import { ShardClientUtil } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { GiveawayEndService } from "@/features/giveaways/application/GiveawayEndService";
import type { GiveawayService } from "@/features/giveaways/application/GiveawayService";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { GiveawayMetrics } from "../metrics/GiveawayMetrics";

/**
 * Ends expired giveaways: draws winners, announces them and disables the
 * giveaway message.
 *
 * Runs on every cluster, and each cluster only ends giveaways for guilds on its
 * own shards. Entries are buffered in a per-cluster GiveawayEntryCacheService,
 * so only the owning cluster can flush them before winners are drawn.
 * GiveawayEndService claims giveaways atomically before drawing, so a giveaway
 * is never drawn twice, even when racing `/giveaway end`.
 */
export class GiveawayTask extends AbstractBackgroundTask {
  readonly name = "Check for expired giveaways";
  readonly cronTime = "*/30 * * * * *"; // Every 30 seconds

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly giveawayService: GiveawayService,
    private readonly giveawayEndService: GiveawayEndService,
    private readonly giveawayMetrics: GiveawayMetrics,
  ) {
    super(client, deploymentService, newModuleLogger("GiveawayTask"));
  }

  shouldRunOnCluster(): boolean {
    return true;
  }

  protected async execute(): Promise<void> {
    const expiredGiveaways = await this.giveawayService.getExpiredGiveaways();

    const ownedGiveaways = expiredGiveaways.filter((giveaway) =>
      this.isGuildOnThisCluster(giveaway.guildId),
    );

    let endedCount = 0;

    if (ownedGiveaways.length > 0) {
      this.logger.info(
        { expiredGiveaways: ownedGiveaways.length },
        "Ending expired giveaways",
      );

      for (const giveaway of ownedGiveaways) {
        try {
          const result = await this.giveawayEndService.endGiveaway(giveaway, {
            endIfChannelUnavailable: true,
          });
          if (
            result.status === "ended" ||
            result.status === "endedWithoutDraw"
          ) {
            endedCount++;
          }
        } catch (err) {
          this.logger.error(
            { err, giveawayId: giveaway.id, guildId: giveaway.guildId },
            "Failed to end giveaway, retrying next run",
          );
        }
      }
    }

    this.giveawayMetrics.endedGiveawaysCounter.add(endedCount);

    // Active count is global, record it from one cluster only
    if (this.client.cluster.shardList.includes(0)) {
      const totalActive = await this.giveawayService.countActiveGiveaways();
      this.giveawayMetrics.activeGiveawaysGauge.record(totalActive);
    }
  }

  private isGuildOnThisCluster(guildId: string): boolean {
    const shardCount = this.client.options.shardCount ?? 1;
    const shardId = ShardClientUtil.shardIdForGuildId(guildId, shardCount);

    return this.client.cluster.shardList.includes(shardId);
  }
}
