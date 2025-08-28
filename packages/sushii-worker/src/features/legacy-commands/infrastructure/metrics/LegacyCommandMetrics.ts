import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("LegacyCommandMetrics");

export class LegacyCommandMetrics {
  readonly legacyCommandDetections: Counter;

  constructor() {
    try {
      const meter = metrics.getMeter("legacy-commands", "1.0");

      this.legacyCommandDetections = meter.createCounter(
        "legacy_command_detections",
        {
          description: "Legacy command usage detections",
          valueType: ValueType.INT,
        },
      );

      logger.info("Legacy command metrics initialized");
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize legacy command metrics",
      );
      throw error;
    }
  }
}
