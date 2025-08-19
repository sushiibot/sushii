import type { Client, GuildTextBasedChannel } from "discord.js";
import { ChannelType } from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { GiveawayDrawService } from "@/features/giveaways/application/GiveawayDrawService";
import type { GiveawayEntryService } from "@/features/giveaways/application/GiveawayEntryService";
import type { GiveawayService } from "@/features/giveaways/application/GiveawayService";
import type { Giveaway } from "@/features/giveaways/domain/entities/Giveaway";
import { buildGiveawayComponents } from "@/features/giveaways/presentation/views/GiveawayComponentBuilder";
import { buildGiveawayEmbed } from "@/features/giveaways/presentation/views/GiveawayEmbedBuilder";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import {
  activeGiveawaysGauge,
  endedGiveawaysCounter,
} from "@/shared/infrastructure/opentelemetry/metrics/feature";
import { AbstractBackgroundTask } from "@/tasks/AbstractBackgroundTask";

export class GiveawayTask extends AbstractBackgroundTask {
  readonly name = "Check for expired giveaways";
  readonly cronTime = "*/30 * * * * *"; // Every 30 seconds

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly giveawayService: GiveawayService,
    private readonly giveawayDrawService: GiveawayDrawService,
    private readonly giveawayEntryService: GiveawayEntryService,
  ) {
    super(client, deploymentService, newModuleLogger("GiveawayTask"));
  }

  protected async execute(): Promise<void> {
    const expiredGiveawaysResult =
      await this.giveawayService.getExpiredGiveaways();

    if (!expiredGiveawaysResult.ok) {
      this.logger.error(
        { err: expiredGiveawaysResult.val },
        "Failed to get expired giveaways",
      );
      return;
    }

    const expiredGiveaways = expiredGiveawaysResult.val;

    this.logger.info(
      {
        expiredGiveaways: expiredGiveaways.length,
      },
      "completing all ended giveaways",
    );

    for (const giveaway of expiredGiveaways) {
      const giveawayChannel = this.client.channels.cache.get(
        giveaway.channelId,
      );
      if (!giveawayChannel || !giveawayChannel.isTextBased()) {
        this.logger.info(
          {
            giveawayId: giveaway.id,
            giveawayChannelId: giveaway.channelId,
          },
          "giveaway channel not found or not text based",
        );

        continue;
      }

      if (giveawayChannel.type !== ChannelType.GuildText) {
        this.logger.info(
          {
            giveawayId: giveaway.id,
            giveawayChannelId: giveaway.channelId,
          },
          "giveaway channel is not a guild text channel",
        );

        continue;
      }

      try {
        // Draw winners
        const drawResult = await this.giveawayDrawService.drawWinners(
          giveaway,
          false, // Auto end ignore allow_repeat_winners
          giveaway.numWinners,
        );

        if (!drawResult.ok) {
          this.logger.error(
            {
              giveawayId: giveaway.id,
              error: drawResult.val,
            },
            "failed to draw giveaway winners",
          );
          continue;
        }

        const { winnerIds } = drawResult.val;

        // Send winners message
        if (winnerIds.length > 0) {
          await this.giveawayDrawService.sendWinnersMessage(
            giveawayChannel,
            giveaway,
            winnerIds,
          );
        }

        // Update giveaway message
        await this.updateGiveawayMessage(giveawayChannel, giveaway, winnerIds);
      } catch (err) {
        this.logger.error(
          {
            giveawayId: giveaway.id,
            error: err,
          },
          "failed to end giveaway",
        );
      }
    }

    // Increment ended metric
    endedGiveawaysCounter.add(expiredGiveaways.length);

    // Update total active metric
    const totalActiveResult = await this.giveawayService.countActiveGiveaways();
    if (totalActiveResult.ok) {
      activeGiveawaysGauge.record(totalActiveResult.val);
    }
  }

  private async updateGiveawayMessage(
    channel: GuildTextBasedChannel,
    giveaway: Giveaway,
    winnerIds: string[],
  ): Promise<void> {
    try {
      const totalEntriesResult = await this.giveawayEntryService.getEntryCount(
        giveaway.id,
      );

      if (!totalEntriesResult.ok) {
        this.logger.error(
          { giveawayId: giveaway.id },
          "Failed to get entry count for message update",
        );
        return;
      }

      const totalEntries = totalEntriesResult.val;
      const embed = buildGiveawayEmbed(giveaway, winnerIds);
      const components = buildGiveawayComponents(
        totalEntries,
        giveaway.isEnded,
      );

      await channel.messages.edit(giveaway.id, {
        embeds: [embed],
        components,
      });
    } catch (err) {
      this.logger.error(
        { err, giveawayId: giveaway.id },
        "Failed to update giveaway message",
      );
    }
  }
}
