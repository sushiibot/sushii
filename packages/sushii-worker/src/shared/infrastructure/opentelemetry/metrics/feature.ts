import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("sushii-features", "1.0");

const metricsPrefix = "sushii-bot.";

export const prefixedName = (name: string): string => `${metricsPrefix}${name}`;

// -----------------------------------------------------------------------------
// General
export const guildGauge = meter.createGauge(prefixedName("guilds"), {
  description: "Number of guilds sushii is in",
});

export const membersGauge = meter.createGauge(prefixedName("members"), {
  description: "Number of members sushii can see",
});

// -----------------------------------------------------------------------------
// Reminders

export const pendingRemindersGauge = meter.createGauge(
  prefixedName("reminders_pending"),
  {
    description: "Pending reminders",
  },
);

export const sentRemindersCounter = meter.createCounter(
  prefixedName("reminders_sent"),
  {
    description: "Sent reminders",
  },
);

// -----------------------------------------------------------------------------
// Keyword notifications

export const activeNotificationsGauge = meter.createGauge(
  prefixedName("notifications_pending"),
  { description: "Active keyword notifications" },
);

export const sentNotificationsCounter = meter.createCounter(
  prefixedName("notifications_sent_count"),
  { description: "Sent keyword notifications" },
);

// -----------------------------------------------------------------------------
// Tempbans

export const pendingTempBansGauge = meter.createGauge(
  prefixedName("tempban_pending"),
  { description: "Pending temporary bans" },
);

export const unbannedTempBansCounter = meter.createCounter(
  prefixedName("tempban_unbanned"),
  {
    description: "Unbanned users from temporary bans",
  },
);

// -----------------------------------------------------------------------------
// Giveaways

export const activeGiveawaysGauge = meter.createGauge(
  prefixedName("giveaways_active"),
  {
    description: "Active giveaways",
  },
);

export const endedGiveawaysCounter = meter.createCounter(
  prefixedName("giveaways_ended"),
  {
    description: "Ended giveaways",
  },
);
