import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, Histogram } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("ScamClassifierMetrics");

export class ScamClassifierMetrics {
  readonly requestCounter: Counter;
  readonly durationHistogram: Histogram;
  readonly tokenCounter: Counter;

  constructor() {
    try {
      const meter = metrics.getMeter("automod", "1.0");

      this.requestCounter = meter.createCounter("automod.classifier.request", {
        description: "AI classification requests",
        valueType: ValueType.INT,
      });

      this.durationHistogram = meter.createHistogram("automod.classifier.duration", {
        description: "AI classification API call duration (ms)",
        valueType: ValueType.DOUBLE,
        unit: "ms",
      });

      this.tokenCounter = meter.createCounter("automod.classifier.tokens", {
        description: "Tokens consumed by AI classification requests",
        valueType: ValueType.INT,
      });

      logger.info("ScamClassifierMetrics initialized successfully");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize ScamClassifierMetrics");
      throw error;
    }
  }
}
