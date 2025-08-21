import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, Gauge } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("NotificationMetrics");

export class NotificationMetrics {
  readonly activeNotificationsGauge: Gauge;
  readonly sentNotificationsCounter: Counter;

  constructor() {
    try {
      const meter = metrics.getMeter("notifications", "1.0");

      this.activeNotificationsGauge = meter.createGauge(
        "notifications_pending",
        {
          description: "Active keyword notifications",
          valueType: ValueType.INT,
        },
      );

      this.sentNotificationsCounter = meter.createCounter(
        "notifications_sent_count",
        {
          description: "Sent keyword notifications",
          valueType: ValueType.INT,
        },
      );

      logger.info("NotificationMetrics initialized successfully");
    } catch (error) {
      logger.error(
        { err: error },
        "Failed to initialize NotificationMetrics - OTEL SDK may not be initialized yet",
      );
      throw error;
    }
  }
}
