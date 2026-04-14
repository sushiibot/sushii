import type { CalendarEventItem } from "./GoogleCalendarClient";
import { ScheduleEvent } from "../../domain/entities/ScheduleEvent";

export function toScheduleEvent(item: CalendarEventItem): ScheduleEvent {
  const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
  const startUtc = item.start?.dateTime ? new Date(item.start.dateTime) : null;
  const startDate = item.start?.date ?? null;
  return new ScheduleEvent(
    item.id,
    item.summary ?? "(no title)",
    startUtc,
    startDate,
    isAllDay,
    item.htmlLink ?? null,
    item.location ?? null,
    item.status,
  );
}
