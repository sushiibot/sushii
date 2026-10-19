import type { Logger } from "pino";

import { GiveawayEntry } from "../domain/entities/GiveawayEntry";
import type { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";

export class GiveawayEntryService {
  constructor(
    private readonly giveawayEntryRepository: GiveawayEntryRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Returns false if the user already entered the giveaway.
   */
  async addEntry(giveawayId: string, userId: string): Promise<boolean> {
    this.logger.debug({ giveawayId, userId }, "Adding user to giveaway");

    const existing = await this.giveawayEntryRepository.findByGiveawayAndUser(
      giveawayId,
      userId,
    );

    if (existing) {
      this.logger.debug(
        { giveawayId, userId },
        "User already entered giveaway",
      );
      return false;
    }

    await this.giveawayEntryRepository.createBatch([
      GiveawayEntry.create(giveawayId, userId),
    ]);

    this.logger.info(
      { giveawayId, userId },
      "User successfully entered giveaway",
    );

    return true;
  }

  async removeEntry(giveawayId: string, userId: string): Promise<void> {
    this.logger.debug({ giveawayId, userId }, "Removing user from giveaway");

    await this.giveawayEntryRepository.delete(giveawayId, userId);

    this.logger.info(
      { giveawayId, userId },
      "User successfully removed from giveaway",
    );
  }

  async hasUserEntered(giveawayId: string, userId: string): Promise<boolean> {
    const entry = await this.giveawayEntryRepository.findByGiveawayAndUser(
      giveawayId,
      userId,
    );

    return entry !== null;
  }

  async getEntryCount(giveawayId: string): Promise<number> {
    return this.giveawayEntryRepository.countByGiveaway(giveawayId);
  }
}
