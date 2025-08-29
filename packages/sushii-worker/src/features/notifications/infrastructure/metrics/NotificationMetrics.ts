import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, ObservableGauge } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("NotificationMetrics");

export class NotificationMetrics {
  readonly activeNotificationsGauge: ObservableGauge;
  readonly sentNotificationsCounter: Counter;

  constructor(
    private readonly getActiveNotificationCount: () => Promise<number>,
  ) {
    try {
      const meter = metrics.getMeter("notifications", "1.0");

      this.activeNotificationsGauge = meter.createObservableGauge(
        "notifications_active",
        {
          description: "Active keyword notifications",
          valueType: ValueType.INT,
        },
      );

      this.activeNotificationsGauge.addCallback(async (result) => {
        const totalActiveKeywords = await this.getActiveNotificationCount();

        result.observe(totalActiveKeywords);
      });

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
