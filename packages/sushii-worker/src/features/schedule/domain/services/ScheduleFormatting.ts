import { time, TimestampStyles } from "discord.js";
import type { ScheduleEvent } from "../entities/ScheduleEvent";

/**
 * Returns a Discord timestamp string for a schedule event.
 * All-day events use LongDate format (:D), timed events use ShortDateTime (:f).
 * Returns empty string if no date is available.
 */
export function formatEventTimestamp(event: ScheduleEvent): string {
  if (event.isAllDay && event.startDate) {
    return time(new Date(`${event.startDate}T00:00:00Z`), TimestampStyles.LongDate);
  }
  if (event.startUtc) {
    return time(event.startUtc, TimestampStyles.ShortDateTime);
  }
  return "";
}
