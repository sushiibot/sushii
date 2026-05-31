import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("ScamCandidateMetrics");

export class ScamCandidateMetrics {
  readonly sightingCounter: Counter;
  readonly reviewCounter: Counter;
  readonly reviewOutcomeCounter: Counter;

  constructor() {
    const meter = metrics.getMeter("automod", "1.0");

    this.sightingCounter = meter.createCounter("automod.candidate.sighting", {
      description: "Scam candidate image set sightings in track()",
      valueType: ValueType.INT,
    });

    this.reviewCounter = meter.createCounter("automod.candidate.review", {
      description: "Scam candidate review attempts",
      valueType: ValueType.INT,
    });

    this.reviewOutcomeCounter = meter.createCounter("automod.candidate.review_outcome", {
      description: "Outcome of scam candidate reviews actioned by moderators",
      valueType: ValueType.INT,
    });

    logger.info("ScamCandidateMetrics initialized successfully");
  }
}
