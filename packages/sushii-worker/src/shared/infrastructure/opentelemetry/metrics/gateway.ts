import { ValueType, metrics } from "@opentelemetry/api";
import type { Client } from "discord.js";
import type { GatewayDispatchEvents } from "discord.js";

const meter = metrics.getMeter("gateway", "1.0");

// -----------------------------------------------------------------------------
// Events
const gatewayEventsCounter = meter.createCounter("gateway_event_count", {
  description: "Discord gateway events",
  valueType: ValueType.INT,
});

export function updateGatewayDispatchEventMetrics(
  event: GatewayDispatchEvents,
): void {
  gatewayEventsCounter.add(1, { event_name: event });
}

// -----------------------------------------------------------------------------
// Shards

const shardStatusGauge = meter.createObservableGauge("shard_status", {
  description: "Discord shard status",
  valueType: ValueType.INT,
});

const shardLatencyGauge = meter.createObservableGauge("shard_latency", {
  description: "Discord shard latency",
  unit: "ms",
  valueType: ValueType.INT,
});

export function registerShardMetrics(client: Client): void {
  shardStatusGauge.addCallback((result) => {
    client.ws.shards.forEach((shard) => {
      result.observe(shard.status, { shard_id: shard.id });
    });
  });

  shardLatencyGauge.addCallback((result) => {
    client.ws.shards.forEach((shard) => {
      result.observe(shard.ping, { shard_id: shard.id });
    });
  });
}
