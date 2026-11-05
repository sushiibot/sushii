import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter } from "@opentelemetry/api";

export type FollowSource = "settings" | "prompt" | "backfill";

export class SushiiUpdatesMetrics {
  readonly follows: Counter;
  readonly unfollows: Counter;

  constructor() {
    const meter = metrics.getMeter("sushii-updates", "1.0");

    this.follows = meter.createCounter("updates.follow", {
      description:
        "Attempts to follow sushii's updates channel by source and outcome",
      valueType: ValueType.INT,
    });
    this.unfollows = meter.createCounter("updates.unfollow", {
      description: "Servers that stopped following sushii's updates channel",
      valueType: ValueType.INT,
    });
  }

  recordFollow(source: FollowSource, outcome: string): void {
    this.follows.add(1, { source, outcome });
  }

  recordUnfollow(source: FollowSource): void {
    this.unfollows.add(1, { source });
  }
}
