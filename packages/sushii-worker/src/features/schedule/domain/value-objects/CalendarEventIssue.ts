import type { CalendarEventItem } from "../../infrastructure/google/GoogleCalendarClient";

export type CalendarEventIssue =
  | { kind: "private"; label: string; actionMessage: string }
  | { kind: "no_title"; label: string; actionMessage: string };

export function calendarItemIssues(item: CalendarEventItem): CalendarEventIssue | null {
  if (item.visibility === "private") {
    return {
      kind: "private",
      label: "Event is private",
      actionMessage:
        "- Open [Google Calendar Settings](https://calendar.google.com/calendar/r/settings) and select your calendar\n- Under **Access permissions for events**, check **Make available to public**\n- Set to **See all event details** (not \"See only free/busy\")",
    };
  }

  if (!item.summary?.trim()) {
    return {
      kind: "no_title",
      label: "Event has no title",
      actionMessage: "Add a title to each of these events in Google Calendar.",
    };
  }

  return null;
}
