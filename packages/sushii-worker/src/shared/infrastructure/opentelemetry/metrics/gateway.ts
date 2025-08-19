import { metrics } from "@opentelemetry/api";
import type { ClusterManager } from "discord-hybrid-sharding";
import type { GatewayDispatchEvents } from "discord.js";

import { prefixedName } from "./feature";

const meter = metrics.getMeter("gateway", "1.0");

// -----------------------------------------------------------------------------
// Events
const gatewayEventsCounter = meter.createCounter(
  prefixedName("discord_events"),
  {
    description: "Discord gateway events",
  },
);

export function updateGatewayDispatchEventMetrics(
  event: GatewayDispatchEvents,
): void {
  gatewayEventsCounter.add(1, { event_name: event });
}

// -----------------------------------------------------------------------------
// Shards

const shardStatusGauge = meter.createGauge(prefixedName("shard_status"), {
  description: "Discord shard status",
});

const shardLatencyGauge = meter.createGauge(prefixedName("shard_latency_ms"), {
  description: "Discord shard latency",
});

const shardLastPingTimestampGauge = meter.createGauge(
  prefixedName("shard_last_ping_timestamp"),
  {
    description: "Discord shard last ping timestamp",
  },
);

export async function updateShardMetrics(
  shardManager: ClusterManager,
): Promise<void> {
  const statuses = await shardManager.broadcastEval((client) =>
    client.ws.shards.map((shard) => {
      const shardId = shard.id;
      const { status, ping } = client.ws;
      const lastPingTimestamp = Date.now();

      return {
        id: shardId,
        status,
        ping,
        lastPingTimestamp,
      };
    }),
  );

  for (const shard of statuses.flat()) {
    const labels = {
      shard_id: shard.id,
    };

    shardStatusGauge.record(shard.status, labels);
    shardLatencyGauge.record(shard.ping, labels);
    shardLastPingTimestampGauge.record(shard.lastPingTimestamp, labels);
  }
}
