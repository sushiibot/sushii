import { ValueType, metrics } from "@opentelemetry/api";
import type { Attributes, Counter, ObservableGauge } from "@opentelemetry/api";
import type { Client, GatewayDispatchPayload } from "discord.js";
import { Events, GatewayDispatchEvents } from "discord.js";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("CoreMetrics");

const UNKNOWN_EVENT_ATTRIBUTES: Attributes = { event_type: "UNKNOWN" };

// Pre-built attribute objects keyed by dispatch event name. Restricting to the
// known GatewayDispatchEvents keeps the metric's cardinality bounded and avoids
// allocating a new attributes object on every gateway event (hot path).
const GATEWAY_EVENT_ATTRIBUTES: ReadonlyMap<string, Attributes> = new Map(
  Object.values(GatewayDispatchEvents).map((t) => [t, { event_type: t }]),
);

export class CoreMetrics {
  // Gateway metrics
  readonly gatewayEventCounter: Counter;
  readonly shardStatusGauge: ObservableGauge;
  readonly shardLatencyGauge: ObservableGauge;

  constructor() {
    try {
      const gatewayMeter = metrics.getMeter("gateway", "1.0");

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

  registerGatewayEventListener(client: Client): void {
    // Events.Raw is only emitted for gateway dispatch (op 0) packets.
    client.on(Events.Raw, (packet: GatewayDispatchPayload) => {
      this.gatewayEventCounter.add(
        1,
        GATEWAY_EVENT_ATTRIBUTES.get(packet.t) ?? UNKNOWN_EVENT_ATTRIBUTES,
      );
    });

    logger.info("Gateway event listener registered");
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
