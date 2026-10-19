import type { Client, GuildTextBasedChannel } from "discord.js";
import { DiscordAPIError, RESTJSONErrorCodes } from "discord.js";
import type { Logger } from "pino";

import type { Giveaway } from "../domain/entities/Giveaway";
import type { DrawResult, GiveawayDrawService } from "./GiveawayDrawService";
import type { GiveawayEntryCacheService } from "./GiveawayEntryCacheService";
import type { GiveawayEntryService } from "./GiveawayEntryService";
import type { GiveawayService } from "./GiveawayService";

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
 * Edits the giveaway message to the ended state. Provided by the composition
 * root so the application layer doesn't depend on presentation-layer builders.
 */
export type GiveawayEndedMessageUpdater = (
  channel: GuildTextBasedChannel,
  giveaway: Giveaway,
  winnerIds: string[],
  entryCount: number,
) => Promise<void>;

export interface EndGiveawayOptions {
  /**
   * End the giveaway without drawing winners if its channel is permanently
   * unavailable. Otherwise it is left active.
   */
  endIfChannelUnavailable: boolean;
}

export type EndGiveawayResult =
  | {
      status: "ended";
      giveaway: Giveaway;
      winnerIds: string[];
      hasInsufficientWinners: boolean;
      reason?: string;
    }
  /** Ended without drawing because the channel is gone */
  | { status: "endedWithoutDraw"; reason: string }
  /** Left active because the channel is gone */
  | { status: "channelUnavailable"; reason: string }
  /** Someone else already ended it */
  | { status: "alreadyEnded" }
  /** Left active, safe to retry later */
  | { status: "retry"; reason: string };

/**
 * Ends a giveaway: flushes buffered entries, atomically claims the giveaway,
 * draws winners, announces them and updates the giveaway message.
 *
 * Shared by GiveawayTask and `/giveaway end`. Entries are buffered per cluster,
 * so this must run on the cluster that owns the giveaway's guild.
 *
 * Unexpected failures (database, Discord API) are thrown. If drawing fails the
 * claim is released first, so the giveaway stays active and is retried.
 */
export class GiveawayEndService {
  constructor(
    private readonly client: Client,
    private readonly giveawayService: GiveawayService,
    private readonly giveawayDrawService: GiveawayDrawService,
    private readonly giveawayEntryService: GiveawayEntryService,
    private readonly giveawayEntryCacheService: GiveawayEntryCacheService,
    private readonly updateEndedMessage: GiveawayEndedMessageUpdater,
    private readonly logger: Logger,
  ) {}

  async endGiveaway(
    activeGiveaway: Giveaway,
    options: EndGiveawayOptions,
  ): Promise<EndGiveawayResult> {
    const logContext = {
      giveawayId: activeGiveaway.id,
      guildId: activeGiveaway.guildId,
      channelId: activeGiveaway.channelId,
    };

    // Write buffered entries first so last-second entries can win
    await this.giveawayEntryCacheService.flush();

    if (this.giveawayEntryCacheService.hasUnflushedEntries(activeGiveaway.id)) {
      this.logger.warn(logContext, "Giveaway has unflushed entries");
      return { status: "retry", reason: "entries could not be saved" };
    }

    // Resolve the channel before claiming so transient failures leave the
    // giveaway active to retry
    const lookup = await this.getGiveawayChannel(activeGiveaway);
    if (lookup.status === "retry") {
      this.logger.info(
        { ...logContext, reason: lookup.reason },
        "Giveaway channel temporarily unavailable",
      );
      return { status: "retry", reason: lookup.reason };
    }

    if (lookup.status === "unavailable" && !options.endIfChannelUnavailable) {
      return { status: "channelUnavailable", reason: lookup.reason };
    }

    const giveaway = await this.giveawayService.claimGiveawayForEnding(
      activeGiveaway.id,
    );
    if (!giveaway) {
      this.logger.debug(logContext, "Giveaway already ended elsewhere");
      return { status: "alreadyEnded" };
    }

    if (lookup.status === "unavailable") {
      this.logger.warn(
        { ...logContext, reason: lookup.reason },
        "Giveaway channel unavailable, ended without drawing winners",
      );
      return { status: "endedWithoutDraw", reason: lookup.reason };
    }

    let drawResult: DrawResult;
    try {
      drawResult = await this.giveawayDrawService.drawWinners(
        giveaway,
        false, // Ending ignores allow_repeat_winners
        giveaway.numWinners,
      );
    } catch (err) {
      await this.releaseClaim(giveaway, logContext);
      throw err;
    }

    const { winnerIds, hasInsufficientWinners, reason } = drawResult;
    const channel = lookup.channel;

    // Winners are drawn and saved at this point, so announcement failures are
    // logged but don't undo ending the giveaway
    if (winnerIds.length > 0) {
      try {
        await this.giveawayDrawService.sendWinnersMessage(
          channel,
          giveaway,
          winnerIds,
        );
      } catch (err) {
        this.logger.warn(
          { ...logContext, err },
          "Failed to announce giveaway winners",
        );
      }
    }

    await this.updateGiveawayMessage(channel, giveaway, winnerIds);

    this.logger.info(
      { ...logContext, winnerCount: winnerIds.length },
      "Ended giveaway",
    );

    return {
      status: "ended",
      giveaway,
      winnerIds,
      hasInsufficientWinners,
      reason,
    };
  }

  /**
   * Undo the claim after drawing failed so the giveaway is retried. The draw
   * error is rethrown by the caller, so a release failure is only logged.
   */
  private async releaseClaim(
    giveaway: Giveaway,
    logContext: Record<string, string>,
  ): Promise<void> {
    try {
      await this.giveawayService.releaseGiveawayEndingClaim(giveaway.id);
    } catch (err) {
      this.logger.error(
        { ...logContext, err },
        "Failed to release giveaway claim, giveaway ended without winners",
      );
    }
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
      const entryCount = await this.giveawayEntryService.getEntryCount(
        giveaway.id,
      );

      await this.updateEndedMessage(channel, giveaway, winnerIds, entryCount);
    } catch (err) {
      this.logger.warn(
        { err, giveawayId: giveaway.id },
        "Failed to update giveaway message",
      );
    }
  }
}
