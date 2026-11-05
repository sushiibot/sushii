import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, Gauge } from "@opentelemetry/api";

import type { DeliveryOutcome } from "../domain/UpdatePost";

export class SushiiUpdatesMetrics {
  readonly relays: Counter;
  readonly postsCaptured: Counter;
  readonly stuckClaims: Gauge;

  constructor() {
    const meter = metrics.getMeter("sushii-updates", "1.0");

    this.relays = meter.createCounter("updates.relay", {
      description: "sushii updates posts forwarded to servers by outcome",
      valueType: ValueType.INT,
    });
    this.postsCaptured = meter.createCounter("updates.posts_captured", {
      description: "New posts stored from sushii's updates channel",
      valueType: ValueType.INT,
    });
    this.stuckClaims = meter.createGauge("updates.stuck_claims", {
      description:
        "Deliveries claimed over 10 minutes ago and never finished, so never retried",
      valueType: ValueType.INT,
    });
  }

  recordRelay(outcome: DeliveryOutcome): void {
    this.relays.add(1, { outcome });
  }

  recordPostCaptured(): void {
    this.postsCaptured.add(1);
  }

  recordStuckClaims(count: number): void {
    this.stuckClaims.record(count);
  }
}
