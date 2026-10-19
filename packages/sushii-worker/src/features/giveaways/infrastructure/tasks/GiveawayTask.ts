import type { Client, GuildTextBasedChannel } from "discord.js";
import {
  DiscordAPIError,
  RESTJSONErrorCodes,
  ShardClientUtil,
} from "discord.js";

import type { DeploymentService } from "@/features/deployment/application/DeploymentService";
import type { GiveawayDrawService } from "@/features/giveaways/application/GiveawayDrawService";
import type { GiveawayEntryCacheService } from "@/features/giveaways/application/GiveawayEntryCacheService";
import type { GiveawayEntryService } from "@/features/giveaways/application/GiveawayEntryService";
import type { GiveawayService } from "@/features/giveaways/application/GiveawayService";
import type { Giveaway } from "@/features/giveaways/domain/entities/Giveaway";
import { buildGiveawayComponents } from "@/features/giveaways/presentation/views/GiveawayComponentBuilder";
import { buildGiveawayEmbed } from "@/features/giveaways/presentation/views/GiveawayEmbedBuilder";
import { newModuleLogger } from "@/shared/infrastructure/logger";
import { AbstractBackgroundTask } from "@/shared/infrastructure/tasks/AbstractBackgroundTask";

import type { GiveawayMetrics } from "../metrics/GiveawayMetrics";

/**
 * Errors meaning the giveaway channel is gone for good, so the giveaway can
 * never be announced.
 */
const PERMANENT_CHANNEL_ERROR_CODES = new Set<number | string>([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.MissingAccess,
]);

type ChannelLookup =
  | { status: "found"; channel: GuildTextBasedChannel }
  | { status: "unavailable"; reason: string }
  | { status: "retry"; reason: string };

/**
 * Ends expired giveaways: draws winners, announces them and disables the
 * giveaway message.
 *
 * Runs on every cluster, and each cluster only ends giveaways for guilds on its
 * own shards. Entries are buffered in a per-cluster GiveawayEntryCacheService,
 * so only the owning cluster can flush them before winners are drawn.
 * Giveaways are claimed atomically before drawing, so a giveaway is never
 * drawn twice even if multiple processes run this task.
 */
export class GiveawayTask extends AbstractBackgroundTask {
  readonly name = "Check for expired giveaways";
  readonly cronTime = "*/30 * * * * *"; // Every 30 seconds

  constructor(
    client: Client,
    deploymentService: DeploymentService,
    private readonly giveawayService: GiveawayService,
    private readonly giveawayDrawService: GiveawayDrawService,
    private readonly giveawayEntryService: GiveawayEntryService,
    private readonly giveawayEntryCacheService: GiveawayEntryCacheService,
    private readonly giveawayMetrics: GiveawayMetrics,
  ) {
    super(client, deploymentService, newModuleLogger("GiveawayTask"));
  }

  shouldRunOnCluster(): boolean {
    return true;
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

    const ownedGiveaways = expiredGiveawaysResult.val.filter((giveaway) =>
      this.isGuildOnThisCluster(giveaway.guildId),
    );

    let endedCount = 0;

    if (ownedGiveaways.length > 0) {
      this.logger.info(
        { expiredGiveaways: ownedGiveaways.length },
        "Ending expired giveaways",
      );

      // Write buffered entries first so last-second entries can win
      await this.giveawayEntryCacheService.flush();

      for (const giveaway of ownedGiveaways) {
        try {
          const ended = await this.endGiveaway(giveaway);
          if (ended) {
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
      const totalActiveResult =
        await this.giveawayService.countActiveGiveaways();
      if (totalActiveResult.ok) {
        this.giveawayMetrics.activeGiveawaysGauge.record(totalActiveResult.val);
      }
    }
  }

  private isGuildOnThisCluster(guildId: string): boolean {
    const shardCount = this.client.options.shardCount ?? 1;
    const shardId = ShardClientUtil.shardIdForGuildId(guildId, shardCount);

    return this.client.cluster.shardList.includes(shardId);
  }

  /**
   * @returns true if this call ended the giveaway
   */
  private async endGiveaway(expiredGiveaway: Giveaway): Promise<boolean> {
    const logContext = {
      giveawayId: expiredGiveaway.id,
      guildId: expiredGiveaway.guildId,
      channelId: expiredGiveaway.channelId,
    };

    if (
      this.giveawayEntryCacheService.hasUnflushedEntries(expiredGiveaway.id)
    ) {
      this.logger.warn(
        logContext,
        "Giveaway has unflushed entries, retrying next run",
      );
      return false;
    }

    // Resolve the channel before claiming so transient failures leave the
    // giveaway active to retry
    const lookup = await this.getGiveawayChannel(expiredGiveaway);
    if (lookup.status === "retry") {
      this.logger.info(
        { ...logContext, reason: lookup.reason },
        "Giveaway channel temporarily unavailable, retrying next run",
      );
      return false;
    }

    const claimResult = await this.giveawayService.claimGiveawayForEnding(
      expiredGiveaway.id,
    );
    if (!claimResult.ok) {
      this.logger.error(
        { ...logContext, err: claimResult.val },
        "Failed to claim giveaway for ending",
      );
      return false;
    }

    const giveaway = claimResult.val;
    if (!giveaway) {
      this.logger.debug(logContext, "Giveaway already ended elsewhere");
      return false;
    }

    if (lookup.status === "unavailable") {
      this.logger.warn(
        { ...logContext, reason: lookup.reason },
        "Giveaway channel unavailable, ended without drawing winners",
      );
      return true;
    }

    const drawResult = await this.giveawayDrawService.drawWinners(
      giveaway,
      false, // Auto end ignore allow_repeat_winners
      giveaway.numWinners,
    );

    if (!drawResult.ok) {
      this.logger.error(
        { ...logContext, err: drawResult.val },
        "Failed to draw giveaway winners, retrying next run",
      );

      const releaseResult =
        await this.giveawayService.releaseGiveawayEndingClaim(giveaway.id);
      if (!releaseResult.ok) {
        this.logger.error(
          { ...logContext, err: releaseResult.val },
          "Failed to release giveaway claim, giveaway ended without winners",
        );
      }

      return false;
    }

    const { winnerIds } = drawResult.val;
    const channel = lookup.channel;

    // Winners are drawn and saved at this point, so announcement failures are
    // logged but don't undo ending the giveaway
    if (winnerIds.length > 0) {
      const sendResult = await this.giveawayDrawService.sendWinnersMessage(
        channel,
        giveaway,
        winnerIds,
      );
      if (!sendResult.ok) {
        this.logger.warn(
          { ...logContext, err: sendResult.val },
          "Failed to announce giveaway winners",
        );
      }
    }

    await this.updateGiveawayMessage(channel, giveaway, winnerIds);

    this.logger.info(
      { ...logContext, winnerCount: winnerIds.length },
      "Ended giveaway",
    );

    return true;
  }

  private async getGiveawayChannel(giveaway: Giveaway): Promise<ChannelLookup> {
    const guild = this.client.guilds.cache.get(giveaway.guildId);

    // Guilds on this cluster's shards are always cached, unless the bot left
    if (!guild) {
      return { status: "unavailable", reason: "bot is not in the guild" };
    }

    if (!guild.available) {
      return { status: "retry", reason: "guild unavailable" };
    }

    let channel;
    try {
      // Uses the cache when possible, otherwise fetches from the API
      channel = await this.client.channels.fetch(giveaway.channelId);
    } catch (err) {
      if (
        err instanceof DiscordAPIError &&
        PERMANENT_CHANNEL_ERROR_CODES.has(err.code)
      ) {
        return { status: "unavailable", reason: err.message };
      }

      throw new Error("Failed to fetch giveaway channel", { cause: err });
    }

    if (!channel) {
      return { status: "unavailable", reason: "channel not found" };
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      return { status: "unavailable", reason: "channel is not text based" };
    }

    return { status: "found", channel };
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
          { err: totalEntriesResult.val, giveawayId: giveaway.id },
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
      this.logger.warn(
        { err, giveawayId: giveaway.id },
        "Failed to update giveaway message",
      );
    }
  }
}
