import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter } from "@opentelemetry/api";

export class FeedbackMetrics {
  readonly submissions: Counter;

  constructor() {
    const meter = metrics.getMeter("feedback", "1.0");

    this.submissions = meter.createCounter("feedback.submissions", {
      description: "Feedback submissions by source, kind, feature and outcome",
      valueType: ValueType.INT,
    });
  }
}
