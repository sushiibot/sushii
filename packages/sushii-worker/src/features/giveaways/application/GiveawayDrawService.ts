import { GuildTextBasedChannel } from "discord.js";
import { Ok, Err, Result } from "ts-results";
import { Logger } from "pino";

import { Giveaway } from "../domain/entities/Giveaway";
import { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";
import { GiveawayRepository } from "../domain/repositories/GiveawayRepository";

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
  ): Promise<Result<DrawResult, string>> {
    try {
      const wantWinnerCount = winnerCount ?? giveaway.numWinners;

      this.logger.debug(
        {
          giveawayId: giveaway.id,
          wantWinnerCount,
          allowRepeatWinners,
        },
        "Drawing giveaway winners",
      );

      // Get random entries
      const entriesResult = await this.giveawayEntryRepository.findRandomEntries(
        giveaway.id,
        wantWinnerCount,
        allowRepeatWinners,
      );

      if (!entriesResult.ok) {
        return Err(entriesResult.val);
      }

      const entries = entriesResult.val;
      const winnerIds = entries.map((entry) => entry.userId);

      // No entries at all
      if (winnerIds.length === 0) {
        this.logger.info(
          { giveawayId: giveaway.id },
          "No winners found - no eligible entries",
        );

        return Ok({
          winnerIds: [],
          hasInsufficientWinners: true,
          reason: "No eligible entries found",
        });
      }

      // Mark winners as picked
      const markResult = await this.giveawayEntryRepository.markAsPicked(
        giveaway.id,
        winnerIds,
      );

      if (!markResult.ok) {
        return Err(markResult.val);
      }

      // Check if we got fewer winners than requested
      const hasInsufficientWinners = winnerIds.length < wantWinnerCount;
      let reason: string | undefined;

      if (hasInsufficientWinners) {
        const totalCountResult = await this.giveawayEntryRepository.countByGiveaway(
          giveaway.id,
        );

        if (totalCountResult.ok) {
          const totalEntries = totalCountResult.val;

          if (totalEntries < wantWinnerCount) {
            reason = `Only ${totalEntries} entries available, but ${wantWinnerCount} winners requested`;
          } else {
            reason = `Some users were excluded (previously picked). Enable repeat winners to include them.`;
          }
        }
      }

      // Mark giveaway as ended if it's not already ended
      if (!giveaway.isEnded) {
        const markEndedResult = await this.giveawayRepository.markAsEnded(giveaway.id);
        if (!markEndedResult.ok) {
          this.logger.warn({
            giveawayId: giveaway.id,
            error: markEndedResult.val,
          }, "Failed to mark giveaway as ended after drawing winners");
        } else {
          this.logger.info({
            giveawayId: giveaway.id,
          }, "Giveaway marked as ended after drawing winners");
        }
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

      return Ok({
        winnerIds,
        hasInsufficientWinners,
        reason,
      });
    } catch (err) {
      this.logger.error(
        { err, giveawayId: giveaway.id },
        "Failed to draw giveaway winners",
      );
      return Err("Failed to draw winners");
    }
  }

  async sendWinnersMessage(
    channel: GuildTextBasedChannel,
    giveaway: Giveaway,
    winnerIds: string[],
  ): Promise<Result<void, string>> {
    try {
      if (winnerIds.length === 0) {
        return Ok(undefined);
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

      return Ok(undefined);
    } catch (err) {
      this.logger.error(
        { err, giveawayId: giveaway.id },
        "Failed to send winners message",
      );
      return Err("Failed to send winners message");
    }
  }
}