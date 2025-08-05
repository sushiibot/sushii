import { Result } from "ts-results";
import { Logger } from "pino";

import { Giveaway, GiveawayData } from "../domain/entities/Giveaway";
import { GiveawayRepository } from "../domain/repositories/GiveawayRepository";

export class GiveawayService {
  constructor(
    private readonly giveawayRepository: GiveawayRepository,
    private readonly logger: Logger,
  ) {}

  async createGiveaway(data: GiveawayData): Promise<Result<Giveaway, string>> {
    try {
      this.logger.debug({ giveawayId: data.id }, "Creating giveaway");
      
      const giveaway = Giveaway.fromData(data);
      const result = await this.giveawayRepository.create(giveaway);
      
      if (result.ok) {
        this.logger.info({ giveawayId: data.id }, "Giveaway created successfully");
      }
      
      return result;
    } catch (err) {
      this.logger.error({ err, giveawayId: data.id }, "Failed to create giveaway");
      throw new Error("Failed to create giveaway", { cause: err });
    }
  }

  async getGiveaway(
    guildId: string,
    giveawayId: string,
  ): Promise<Result<Giveaway | null, string>> {
    try {
      return await this.giveawayRepository.findByGuildAndId(guildId, giveawayId);
    } catch (err) {
      this.logger.error({ err, guildId, giveawayId }, "Failed to get giveaway");
      throw new Error("Failed to get giveaway", { cause: err });
    }
  }

  async getActiveGiveaways(
    guildId: string,
    limit?: number,
  ): Promise<Result<Giveaway[], string>> {
    try {
      return await this.giveawayRepository.findActiveByGuild(guildId, limit);
    } catch (err) {
      this.logger.error({ err, guildId }, "Failed to get active giveaways");
      throw new Error("Failed to get active giveaways", { cause: err });
    }
  }

  async getCompletedGiveaways(
    guildId: string,
    limit?: number,
  ): Promise<Result<Giveaway[], string>> {
    try {
      return await this.giveawayRepository.findCompletedByGuild(guildId, limit);
    } catch (err) {
      this.logger.error({ err, guildId }, "Failed to get completed giveaways");
      throw new Error("Failed to get completed giveaways", { cause: err });
    }
  }

  async deleteGiveaway(
    guildId: string,
    giveawayId: string,
  ): Promise<Result<Giveaway | null, string>> {
    try {
      this.logger.debug({ guildId, giveawayId }, "Deleting giveaway");
      
      const result = await this.giveawayRepository.delete(guildId, giveawayId);
      
      if (result.ok && result.val) {
        this.logger.info({ guildId, giveawayId }, "Giveaway deleted successfully");
      }
      
      return result;
    } catch (err) {
      this.logger.error({ err, guildId, giveawayId }, "Failed to delete giveaway");
      throw new Error("Failed to delete giveaway", { cause: err });
    }
  }

  async markAsEnded(giveawayId: string): Promise<Result<Giveaway | null, string>> {
    try {
      this.logger.debug({ giveawayId }, "Marking giveaway as ended");
      
      const result = await this.giveawayRepository.markAsEnded(giveawayId);
      
      if (result.ok && result.val) {
        this.logger.info({ giveawayId }, "Giveaway marked as ended");
      }
      
      return result;
    } catch (err) {
      this.logger.error({ err, giveawayId }, "Failed to mark giveaway as ended");
      throw new Error("Failed to mark giveaway as ended", { cause: err });
    }
  }

  async getExpiredGiveaways(): Promise<Result<Giveaway[], string>> {
    try {
      return await this.giveawayRepository.findAndMarkExpiredAsEnded();
    } catch (err) {
      this.logger.error({ err }, "Failed to get expired giveaways");
      throw new Error("Failed to get expired giveaways", { cause: err });
    }
  }

  async countActiveGiveaways(): Promise<Result<number, string>> {
    try {
      return await this.giveawayRepository.countActiveGiveaways();
    } catch (err) {
      this.logger.error({ err }, "Failed to count active giveaways");
      throw new Error("Failed to count active giveaways", { cause: err });
    }
  }
}