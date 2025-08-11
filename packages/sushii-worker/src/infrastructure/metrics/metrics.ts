import { Counter, Gauge, collectDefaultMetrics } from "prom-client";

const metricsPrefix = "sushii_ts_worker_";

export const prefixedName = (name: string): string => `${metricsPrefix}${name}`;

// PerformanceObserver is implemented in Bun v1.0.22
// monitorEventLoopDelay is missing.

// Enable only if bun is not defined
if (typeof Bun === "undefined") {
  collectDefaultMetrics({
    prefix: metricsPrefix,
  });
}

// -----------------------------------------------------------------------------
// General
export const guildGauge = new Gauge({
  name: prefixedName("guilds"),
  help: "Number of guilds sushii is in",
});

export const membersGauge = new Gauge({
  name: prefixedName("members"),
  help: "Number of members sushii can see",
});

// -----------------------------------------------------------------------------
// Reminders

export const pendingRemindersGauge = new Gauge({
  name: prefixedName("reminders_pending"),
  help: "Pending reminders",
});

export const sentRemindersCounter = new Counter({
  name: prefixedName("reminders_sent"),
  help: "Sent reminders",
  labelNames: ["status"],
});

// -----------------------------------------------------------------------------
// Keyword notifications

export const activeNotificationsGauge = new Gauge({
  name: prefixedName("notifications_pending"),
  help: "Active keyword notifications",
});

export const sentNotificationsCounter = new Counter({
  name: prefixedName("notifications_sent_count"),
  help: "Sent keyword notifications",
  labelNames: ["status"],
});

// -----------------------------------------------------------------------------
// Tempbans

export const pendingTempBansGauge = new Gauge({
  name: prefixedName("tempban_pending"),
  help: "Pending temporary bans",
});

export const unbannedTempBansCounter = new Counter({
  name: prefixedName("tempban_unbanned"),
  help: "Unbanned users from temporary bans",
  labelNames: ["status"],
});

// -----------------------------------------------------------------------------
// Giveaways

export const activeGiveawaysGauge = new Gauge({
  name: prefixedName("giveaways_active"),
  help: "Active giveaways",
});

export const endedGiveawaysCounter = new Counter({
  name: prefixedName("giveaways_ended"),
  help: "Ended giveaways",
});
