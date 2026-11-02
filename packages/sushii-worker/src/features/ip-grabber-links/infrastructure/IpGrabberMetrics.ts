import { type Counter, ValueType, metrics } from "@opentelemetry/api";

export class IpGrabberMetrics {
  readonly syncCounter: Counter;
  readonly checkCounter: Counter;
  readonly discoveredCounter: Counter;
  readonly endpointFetchCounter: Counter;

  constructor() {
    const meter = metrics.getMeter("ip_grabber_links", "1.0");

    this.syncCounter = meter.createCounter("automod.ip_grabber.sync", {
      description:
        "IP grabber keyword syncs into native AutoMod rules, by outcome",
      valueType: ValueType.INT,
    });

    this.checkCounter = meter.createCounter("automod.ip_grabber.check", {
      description:
        "IP grabber detection checks on hostnames, by provider and outcome",
      valueType: ValueType.INT,
    });

    this.discoveredCounter = meter.createCounter(
      "automod.ip_grabber.discovered",
      {
        description: "New IP grabber domains added, by provider and source",
        valueType: ValueType.INT,
      },
    );

    this.endpointFetchCounter = meter.createCounter(
      "automod.ip_grabber.endpoint_fetch",
      {
        description: "Grabify domain list fetches, by outcome",
        valueType: ValueType.INT,
      },
    );
  }
}
