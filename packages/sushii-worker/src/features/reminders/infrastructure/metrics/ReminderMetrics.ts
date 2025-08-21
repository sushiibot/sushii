import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter, Gauge } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("ReminderMetrics");

export class ReminderMetrics {
  readonly pendingRemindersGauge: Gauge;
  readonly sentRemindersCounter: Counter;

  constructor() {
    try {
      const meter = metrics.getMeter("reminders", "1.0");

      this.pendingRemindersGauge = meter.createGauge("pending_reminders", {
        description: "Number of pending reminders in the system",
        valueType: ValueType.INT,
      });

      this.sentRemindersCounter = meter.createCounter("sent_reminders", {
        description: "Number of reminder notifications sent",
        valueType: ValueType.INT,
      });

      logger.info("ReminderMetrics initialized successfully");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize ReminderMetrics - OTEL SDK may not be initialized yet");
      throw error;
    }
  }
}