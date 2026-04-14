import type { CalendarEventItem } from "../../infrastructure/google/GoogleCalendarClient";
import type { ScheduleEvent } from "../entities/ScheduleEvent";

export type CalendarEventChangeKind = "added" | "updated" | "removed";

export interface CalendarEventChange {
  readonly kind: CalendarEventChangeKind;
  readonly item: CalendarEventItem;
  /** Populated for "updated" and "removed" — the state before this change. */
  readonly previousEvent: ScheduleEvent | undefined;
}

/**
 * Classifies a list of raw calendar items into typed changes given a snapshot
 * of the previous event state.
 */
export function classifyChanges(
  items: CalendarEventItem[],
  previousEvents: Map<string, ScheduleEvent>,
): CalendarEventChange[] {
  return items.map((item) => {
    const previousEvent = previousEvents.get(item.id);
    if (item.status === "cancelled") {
      return { kind: "removed", item, previousEvent };
    }
    return { kind: previousEvent ? "updated" : "added", item, previousEvent };
  });
}
