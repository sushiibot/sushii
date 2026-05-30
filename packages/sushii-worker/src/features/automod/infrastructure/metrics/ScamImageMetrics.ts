import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, Histogram } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("ScamImageMetrics");

export class ScamImageMetrics {
  readonly checkCounter: Counter;
  readonly matchCounter: Counter;
  readonly downloadDurationHistogram: Histogram;
  readonly hashDurationHistogram: Histogram;

  constructor() {
    const meter = metrics.getMeter("automod", "1.0");

    this.checkCounter = meter.createCounter("automod.scam_image.check", {
      description: "Scam image attachment checks",
      valueType: ValueType.INT,
    });

    this.matchCounter = meter.createCounter("automod.scam_image.match", {
      description: "Scam image matches found",
      valueType: ValueType.INT,
    });

    this.downloadDurationHistogram = meter.createHistogram(
      "automod.scam_image.download_duration",
      {
        description: "Time to download an image attachment (ms)",
        valueType: ValueType.DOUBLE,
        unit: "ms",
      },
    );

    this.hashDurationHistogram = meter.createHistogram(
      "automod.scam_image.hash_duration",
      {
        description: "Time to compute dHash for an image buffer (ms)",
        valueType: ValueType.DOUBLE,
        unit: "ms",
      },
    );

    logger.info("ScamImageMetrics initialized successfully");
  }
}
