import { time, TimestampStyles } from "discord.js";
import type { ScheduleEvent } from "@/features/schedule/domain/entities/ScheduleEvent";

/**
 * Returns a Discord timestamp string for a schedule event.
 * All-day events use ShortDate format (:d), timed events use ShortDate + ShortTime (:d, :t).
 * Returns empty string if no date is available.
 */
export function formatEventTimestamp(event: ScheduleEvent): string {
  if (event.isAllDay && event.startDate) {
    return time(new Date(`${event.startDate}T00:00:00Z`), TimestampStyles.ShortDate);
  }
  if (event.startUtc) {
    return time(event.startUtc, TimestampStyles.ShortDateShortTime);
  }
  return "";
}

export function formatPollInterval(pollIntervalSec: number): string {
  const intervalMin = Math.floor(pollIntervalSec / 60);
  return intervalMin >= 1
    ? `every ${intervalMin} minute${intervalMin !== 1 ? "s" : ""}`
    : `every ${pollIntervalSec} seconds`;
}
