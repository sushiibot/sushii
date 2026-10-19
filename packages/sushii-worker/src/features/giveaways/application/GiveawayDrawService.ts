import type { GuildTextBasedChannel } from "discord.js";
import type { Logger } from "pino";

import type { Giveaway } from "../domain/entities/Giveaway";
import type { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";
import type { GiveawayRepository } from "../domain/repositories/GiveawayRepository";

export interface DrawResult {
  winnerIds: string[];
  hasInsufficientWinners: boolean;
  reason?: string;
}

export class GiveawayDrawService {
  constructor(
    private readonly giveawayEntryRepository: GiveawayEntryRepository,
    private readonly giveawayRepository: GiveawayRepository,
    private readonly logger: Logger,
  ) {}

  async drawWinners(
    giveaway: Giveaway,
    allowRepeatWinners: boolean,
    winnerCount?: number,
  ): Promise<DrawResult> {
    const wantWinnerCount = winnerCount ?? giveaway.numWinners;

    this.logger.debug(
      {
        giveawayId: giveaway.id,
        wantWinnerCount,
        allowRepeatWinners,
      },
      "Drawing giveaway winners",
    );

    const entries = await this.giveawayEntryRepository.findRandomEntries(
      giveaway.id,
      wantWinnerCount,
      allowRepeatWinners,
    );
    const winnerIds = entries.map((entry) => entry.userId);

    // No entries at all
    if (winnerIds.length === 0) {
      this.logger.info(
        { giveawayId: giveaway.id },
        "No winners found - no eligible entries",
      );

      return {
        winnerIds: [],
        hasInsufficientWinners: true,
        reason: "No eligible entries found",
      };
    }

    await this.giveawayEntryRepository.markAsPicked(giveaway.id, winnerIds);

    // Check if we got fewer winners than requested
    const hasInsufficientWinners = winnerIds.length < wantWinnerCount;
    let reason: string | undefined;

    if (hasInsufficientWinners) {
      const totalEntries = await this.giveawayEntryRepository.countByGiveaway(
        giveaway.id,
      );

      if (totalEntries < wantWinnerCount) {
        reason = `Only ${totalEntries} entries available, but ${wantWinnerCount} winners requested`;
      } else {
        reason = `Some users were excluded (previously picked). Enable repeat winners to include them.`;
      }
    }

    // Mark giveaway as ended if it's not already ended
    if (!giveaway.isEnded) {
      await this.giveawayRepository.markAsEnded(giveaway.id);

      this.logger.info(
        { giveawayId: giveaway.id },
        "Giveaway marked as ended after drawing winners",
      );
    }

    this.logger.info(
      {
        giveawayId: giveaway.id,
        winnerCount: winnerIds.length,
        requestedCount: wantWinnerCount,
        hasInsufficientWinners,
      },
      "Giveaway winners drawn",
    );

    return {
      winnerIds,
      hasInsufficientWinners,
      reason,
    };
  }

  async sendWinnersMessage(
    channel: GuildTextBasedChannel,
    giveaway: Giveaway,
    winnerIds: string[],
  ): Promise<void> {
    if (winnerIds.length === 0) {
      return;
    }

    const winnersStr = winnerIds.map((id) => `<@${id}>`).join(", ");
    await channel.send({
      content: `Congratulations to ${winnersStr}! You won: **${giveaway.prize}**`,
      reply: {
        messageReference: giveaway.id,
      },
    });

    this.logger.info(
      {
        giveawayId: giveaway.id,
        winnerCount: winnerIds.length,
      },
      "Sent winners announcement message",
    );
  }
}
