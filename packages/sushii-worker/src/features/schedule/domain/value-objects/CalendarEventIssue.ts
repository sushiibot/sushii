import type { CalendarEventItem } from "../../infrastructure/google/GoogleCalendarClient";

export type CalendarEventIssue =
  | { kind: "private"; label: string; actionMessage: string }
  | { kind: "no_title"; label: string; actionMessage: string };

export function calendarItemIssues(item: CalendarEventItem): CalendarEventIssue[] {
  if (item.visibility === "private") {
    return [
      {
        kind: "private",
        label: "Event is private",
        actionMessage:
          'Open the event in Google Calendar and change "See only free/busy" to "See all event details".',
      },
    ];
  }

  if (!item.summary?.trim()) {
    return [
      {
        kind: "no_title",
        label: "Event has no title",
        actionMessage: "Add a title to this event in Google Calendar.",
      },
    ];
  }

  return [];
}
