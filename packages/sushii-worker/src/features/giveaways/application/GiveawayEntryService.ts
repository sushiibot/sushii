import { Ok, Err, Result } from "ts-results";
import { Logger } from "pino";

import { GiveawayEntry } from "../domain/entities/GiveawayEntry";
import { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";

export class GiveawayEntryService {
  constructor(
    private readonly giveawayEntryRepository: GiveawayEntryRepository,
    private readonly logger: Logger,
  ) {}

  async addEntry(
    giveawayId: string,
    userId: string,
  ): Promise<Result<boolean, string>> {
    try {
      this.logger.debug(
        { giveawayId, userId },
        "Adding user to giveaway",
      );

      // Check if user already entered
      const existingResult = await this.giveawayEntryRepository.findByGiveawayAndUser(
        giveawayId,
        userId,
      );

      if (!existingResult.ok) {
        return Err(existingResult.val);
      }

      if (existingResult.val) {
        this.logger.debug(
          { giveawayId, userId },
          "User already entered giveaway",
        );
        return Ok(false);
      }

      // Create new entry
      const entry = GiveawayEntry.create(giveawayId, userId);
      const createResult = await this.giveawayEntryRepository.createBatch([entry]);

      if (!createResult.ok) {
        return Err(createResult.val);
      }

      this.logger.info(
        { giveawayId, userId },
        "User successfully entered giveaway",
      );

      return Ok(true);
    } catch (err) {
      this.logger.error(
        { err, giveawayId, userId },
        "Failed to add giveaway entry",
      );
      return Err("Failed to add entry");
    }
  }

  async removeEntry(
    giveawayId: string,
    userId: string,
  ): Promise<Result<void, string>> {
    try {
      this.logger.debug(
        { giveawayId, userId },
        "Removing user from giveaway",
      );

      const result = await this.giveawayEntryRepository.delete(giveawayId, userId);

      if (result.ok) {
        this.logger.info(
          { giveawayId, userId },
          "User successfully removed from giveaway",
        );
      }

      return result;
    } catch (err) {
      this.logger.error(
        { err, giveawayId, userId },
        "Failed to remove giveaway entry",
      );
      return Err("Failed to remove entry");
    }
  }

  async hasUserEntered(
    giveawayId: string,
    userId: string,
  ): Promise<Result<boolean, string>> {
    try {
      const result = await this.giveawayEntryRepository.findByGiveawayAndUser(
        giveawayId,
        userId,
      );

      if (!result.ok) {
        return Err(result.val);
      }

      return Ok(!!result.val);
    } catch (err) {
      this.logger.error(
        { err, giveawayId, userId },
        "Failed to check if user entered giveaway",
      );
      return Err("Failed to check entry status");
    }
  }

  async getEntryCount(giveawayId: string): Promise<Result<number, string>> {
    try {
      return await this.giveawayEntryRepository.countByGiveaway(giveawayId);
    } catch (err) {
      this.logger.error(
        { err, giveawayId },
        "Failed to get giveaway entry count",
      );
      return Err("Failed to get entry count");
    }
  }
}