import type { Logger } from "pino";

import { StatName } from "../domain/StatName";
import type {
  BotStat,
  StatsRepository,
} from "../domain/repositories/StatsRepository";

export class StatsService {
  constructor(
    private readonly statsRepository: StatsRepository,
    private readonly logger: Logger,
  ) {}

  async updateStat(
    name: StatName,
    value: number,
    action: "set" | "add",
  ): Promise<void> {
    // Input validation
    if (!Number.isInteger(value)) {
      throw new Error("Stat value must be an integer");
    }

    if (value < 0) {
      throw new Error("Stat value cannot be negative");
    }

    if (value > Number.MAX_SAFE_INTEGER) {
      throw new Error("Stat value exceeds safe integer range");
    }

    // Validate enum value (TypeScript helps but runtime safety is good)
    if (!Object.values(StatName).includes(name)) {
      throw new Error(`Invalid stat name: ${name}`);
    }

    this.logger.info(
      {
        stat: name,
        value,
        action,
      },
      "Updating bot stat",
    );

    try {
      if (action === "add") {
        await this.statsRepository.incrementStat(name, "bot", value);
      } else {
        await this.statsRepository.setStat(name, "bot", value);
      }
    } catch (error) {
      this.logger.error(
        { err: error, stat: name, value, action },
        "Failed to update stat",
      );
      throw new Error("Stat update failed", { cause: error });
    }
  }

  async getStats(): Promise<BotStat[]> {
    try {
      return await this.statsRepository.getAllStats();
    } catch (error) {
      this.logger.error({ err: error }, "Failed to retrieve stats");
      throw new Error("Failed to retrieve bot statistics", { cause: error });
    }
  }
}
