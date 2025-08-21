import { ValueType, metrics } from "@opentelemetry/api";
import type { Gauge } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("StatsMetrics");

export class StatsMetrics {
  readonly guildGauge: Gauge;
  readonly membersGauge: Gauge;

  constructor() {
    try {
      const meter = metrics.getMeter("stats", "1.0");

      this.guildGauge = meter.createGauge("guilds", {
        description: "Number of guilds sushii is in",
        valueType: ValueType.INT,
      });

      this.membersGauge = meter.createGauge("members", {
        description: "Number of members sushii can see",
        valueType: ValueType.INT,
      });

      logger.info("StatsMetrics initialized successfully");
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize StatsMetrics - OTEL SDK may not be initialized yet",
      );
      throw error;
    }
  }
}
