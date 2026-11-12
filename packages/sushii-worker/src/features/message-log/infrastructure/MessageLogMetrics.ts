import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter } from "@opentelemetry/api";

export class MessageLogMetrics {
  readonly interactionCached: Counter;

  constructor() {
    const meter = metrics.getMeter("message_log", "1.0");

    this.interactionCached = meter.createCounter(
      "message_log.interaction_cached",
      {
        description: "App interaction responses from other bots cached",
        valueType: ValueType.INT,
      },
    );
  }
}
