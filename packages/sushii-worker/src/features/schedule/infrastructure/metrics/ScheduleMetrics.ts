import { ValueType, metrics } from "@opentelemetry/api";
import type { Counter } from "@opentelemetry/api";

import { newModuleLogger } from "@/shared/infrastructure/logger";

const logger = newModuleLogger("ScheduleMetrics");

export class ScheduleMetrics {
  /** Incremented once per pollSchedule() call, labelled by outcome. */
  readonly pollCounter: Counter;

  /** Incremented per Discord message operation during syncMessages(). */
  readonly messagesSyncedCounter: Counter;

  /** Incremented per calendar event change sent to the log channel. */
  readonly eventsChangedCounter: Counter;

  constructor() {
    try {
      const meter = metrics.getMeter("schedule", "1.0");

      this.pollCounter = meter.createCounter("schedule_poll_total", {
        description: "Schedule poll attempts labelled by outcome",
        valueType: ValueType.INT,
      });

      this.messagesSyncedCounter = meter.createCounter("schedule_messages_synced_total", {
        description: "Discord schedule messages touched during sync, labelled by operation",
        valueType: ValueType.INT,
      });

      this.eventsChangedCounter = meter.createCounter("schedule_events_changed_total", {
        description: "Calendar event changes sent to log channel, labelled by kind",
        valueType: ValueType.INT,
      });

      logger.info("ScheduleMetrics initialized successfully");
    } catch (error) {
      logger.error({ err: error }, "Failed to initialize ScheduleMetrics");
      throw error;
    }
  }
}
