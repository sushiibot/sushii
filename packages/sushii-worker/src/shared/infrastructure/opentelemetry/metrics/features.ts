import { ValueType, metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("sushii-features", "1.0");

// -----------------------------------------------------------------------------
// General
export const guildGauge = meter.createGauge("guilds", {
  description: "Number of guilds sushii is in",
  valueType: ValueType.INT,
});

export const membersGauge = meter.createGauge("members", {
  description: "Number of members sushii can see",
  valueType: ValueType.INT,
});

// -----------------------------------------------------------------------------
// Reminders

export const pendingRemindersGauge = meter.createGauge("reminders_pending", {
  description: "Pending reminders",
  valueType: ValueType.INT,
});

export const sentRemindersCounter = meter.createCounter("reminders_sent", {
  description: "Sent reminders",
  valueType: ValueType.INT,
});

// -----------------------------------------------------------------------------
// Keyword notifications

export const activeNotificationsGauge = meter.createGauge(
  "notifications_pending",
  { description: "Active keyword notifications", valueType: ValueType.INT },
);

export const sentNotificationsCounter = meter.createCounter(
  "notifications_sent_count",
  { description: "Sent keyword notifications", valueType: ValueType.INT },
);

// -----------------------------------------------------------------------------
// Tempbans

export const pendingTempBansGauge = meter.createGauge("tempban_pending", {
  description: "Pending temporary bans",
  valueType: ValueType.INT,
});

export const unbannedTempBansCounter = meter.createCounter("tempban_unbanned", {
  description: "Unbanned users from temporary bans",
  valueType: ValueType.INT,
});

// -----------------------------------------------------------------------------
// Giveaways

export const activeGiveawaysGauge = meter.createGauge("giveaways_active", {
  description: "Active giveaways",
  valueType: ValueType.INT,
});

export const endedGiveawaysCounter = meter.createCounter("giveaways_ended", {
  description: "Ended giveaways",
  valueType: ValueType.INT,
});
