import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, Gauge } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("GiveawayMetrics");

export class GiveawayMetrics {
  readonly activeGiveawaysGauge: Gauge;
  readonly endedGiveawaysCounter: Counter;

  constructor() {
    try {
      const meter = metrics.getMeter("giveaways", "1.0");

      this.activeGiveawaysGauge = meter.createGauge("giveaways_active", {
        description: "Active giveaways",
        valueType: ValueType.INT,
      });

      this.endedGiveawaysCounter = meter.createCounter("giveaways_ended", {
        description: "Ended giveaways",
        valueType: ValueType.INT,
      });

      logger.info("GiveawayMetrics initialized successfully");
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize GiveawayMetrics - OTEL SDK may not be initialized yet",
      );
      throw error;
    }
  }
}
