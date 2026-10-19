import type { Logger } from "pino";

import type { GiveawayData } from "../domain/entities/Giveaway";
import { Giveaway } from "../domain/entities/Giveaway";
import type { GiveawayRepository } from "../domain/repositories/GiveawayRepository";

export class GiveawayService {
  constructor(
    private readonly giveawayRepository: GiveawayRepository,
    private readonly logger: Logger,
  ) {}

  async createGiveaway(data: GiveawayData): Promise<Giveaway> {
    this.logger.debug({ giveawayId: data.id }, "Creating giveaway");

    const giveaway = await this.giveawayRepository.create(
      Giveaway.fromData(data),
    );

    this.logger.info({ giveawayId: data.id }, "Giveaway created successfully");

    return giveaway;
  }

  async getGiveaway(
    guildId: string,
    giveawayId: string,
  ): Promise<Giveaway | null> {
    return this.giveawayRepository.findByGuildAndId(guildId, giveawayId);
  }

  async getActiveGiveaways(
    guildId: string,
    limit?: number,
  ): Promise<Giveaway[]> {
    return this.giveawayRepository.findActiveByGuild(guildId, limit);
  }

  async getCompletedGiveaways(
    guildId: string,
    limit?: number,
  ): Promise<Giveaway[]> {
    return this.giveawayRepository.findCompletedByGuild(guildId, limit);
  }

  /**
   * Returns the deleted giveaway, or null if it doesn't exist.
   */
  async deleteGiveaway(
    guildId: string,
    giveawayId: string,
  ): Promise<Giveaway | null> {
    this.logger.debug({ guildId, giveawayId }, "Deleting giveaway");

    const deleted = await this.giveawayRepository.delete(guildId, giveawayId);

    if (deleted) {
      this.logger.info(
        { guildId, giveawayId },
        "Giveaway deleted successfully",
      );
    }

    return deleted;
  }

  /**
   * Returns the ended giveaway, or null if it doesn't exist.
   */
  async markAsEnded(giveawayId: string): Promise<Giveaway | null> {
    this.logger.debug({ giveawayId }, "Marking giveaway as ended");

    const giveaway = await this.giveawayRepository.markAsEnded(giveawayId);

    if (giveaway) {
      this.logger.info({ giveawayId }, "Giveaway marked as ended");
    }

    return giveaway;
  }

  /**
   * Expired giveaways that still need to be ended. They are not claimed, use
   * claimGiveawayForEnding before drawing winners.
   */
  async getExpiredGiveaways(): Promise<Giveaway[]> {
    return this.giveawayRepository.findExpired();
  }

  /**
   * Mark a giveaway as ended if no one else has. Returns null if it was
   * already ended, so winners are only drawn once.
   */
  async claimGiveawayForEnding(giveawayId: string): Promise<Giveaway | null> {
    return this.giveawayRepository.claimForEnding(giveawayId);
  }

  /**
   * Release a claim after ending failed, so the giveaway is retried.
   */
  async releaseGiveawayEndingClaim(giveawayId: string): Promise<void> {
    return this.giveawayRepository.releaseEndingClaim(giveawayId);
  }

  async countActiveGiveaways(): Promise<number> {
    return this.giveawayRepository.countActiveGiveaways();
  }
}
