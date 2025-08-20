import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, ObservableGauge } from "@opentelemetry/api";
import type { Client } from "discord.js";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("CoreMetrics");

export class CoreMetrics {
  // Gateway metrics
  readonly gatewayEventCounter: Counter;
  readonly shardStatusGauge: ObservableGauge;
  readonly shardLatencyGauge: ObservableGauge;

  constructor() {
    try {
      const gatewayMeter = metrics.getMeter("gateway", "1.0");

      // TODO: Hook up gateway event counter to raw Discord event listener
      this.gatewayEventCounter = gatewayMeter.createCounter(
        "gateway_event_count",
        {
          description: "Discord gateway events",
          valueType: ValueType.INT,
        },
      );

      this.shardStatusGauge = gatewayMeter.createObservableGauge(
        "shard_status",
        {
          description: "Discord shard status",
          valueType: ValueType.INT,
        },
      );

      this.shardLatencyGauge = gatewayMeter.createObservableGauge(
        "shard_latency",
        {
          description: "Discord shard latency",
          unit: "ms",
          valueType: ValueType.INT,
        },
      );

      logger.info("CoreMetrics initialized successfully");
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize CoreMetrics - OTEL SDK may not be initialized yet",
      );
      throw error;
    }
  }

  registerShardCallbacks(client: Client): void {
    this.shardStatusGauge.addCallback((result) => {
      client.ws.shards.forEach((shard) => {
        result.observe(shard.status, { shard_id: shard.id });
      });
    });

    this.shardLatencyGauge.addCallback((result) => {
      client.ws.shards.forEach((shard) => {
        result.observe(shard.ping, { shard_id: shard.id });
      });
    });

    logger.info("Shard metric callbacks registered");
  }
}
