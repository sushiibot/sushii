import { ValueType, metrics } from "@opentelemetry/api";

// LEGACY: This file contains metrics for the legacy RemindersTask
// TODO: Migrate RemindersTask to Clean Architecture and remove this file
const meter = metrics.getMeter("sushii-features", "1.0");

// -----------------------------------------------------------------------------
// Reminders (Legacy)

export const pendingRemindersGauge = meter.createGauge("reminders_pending", {
  description: "Pending reminders",
  valueType: ValueType.INT,
});

export const sentRemindersCounter = meter.createCounter("reminders_sent", {
  description: "Sent reminders",
  valueType: ValueType.INT,
});