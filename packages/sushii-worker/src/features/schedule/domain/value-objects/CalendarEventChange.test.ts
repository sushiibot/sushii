import { describe, expect, it } from "bun:test";

import { ScheduleEvent } from "@/features/schedule/domain/entities/ScheduleEvent";
import type { CalendarEventItem } from "@/features/schedule/infrastructure/google/GoogleCalendarClient";
import { classifyChanges } from "./CalendarEventChange";

function makeItem(
  id: string,
  status: CalendarEventItem["status"] = "confirmed",
  summary = "Event",
): CalendarEventItem {
  return { id, status, summary };
}

function makeStoredEvent(id: string, summary = "Old Title"): ScheduleEvent {
  return new ScheduleEvent(id, summary, new Date("2024-06-20T10:00:00Z"), null, false, null, null, "confirmed");
}

describe("classifyChanges", () => {
  it("classifies a new event (no previous) as added", () => {
    const items = [makeItem("evt1")];
    const previous = new Map<string, ScheduleEvent>();
    const changes = classifyChanges(items, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("added");
    expect(changes[0].item.id).toBe("evt1");
    expect(changes[0].previousEvent).toBeUndefined();
  });

  it("classifies an existing event (has previous) as updated", () => {
    const items = [makeItem("evt1", "confirmed", "New Title")];
    const previous = new Map([["evt1", makeStoredEvent("evt1", "Old Title")]]);
    const changes = classifyChanges(items, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("updated");
    expect(changes[0].previousEvent?.summary).toBe("Old Title");
  });

  it("classifies a cancelled event as removed", () => {
    const items = [makeItem("evt1", "cancelled")];
    const previous = new Map([["evt1", makeStoredEvent("evt1")]]);
    const changes = classifyChanges(items, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("removed");
    expect(changes[0].previousEvent).toBeDefined();
  });

  it("classifies a cancelled event with no previous as removed (with undefined previousEvent)", () => {
    const items = [makeItem("evt1", "cancelled")];
    const previous = new Map<string, ScheduleEvent>();
    const changes = classifyChanges(items, previous);

    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("removed");
    expect(changes[0].previousEvent).toBeUndefined();
  });

  it("handles a mix of added, updated, and removed in one call", () => {
    const items = [
      makeItem("new1", "confirmed", "New Event"),
      makeItem("existing1", "confirmed", "Updated Event"),
      makeItem("gone1", "cancelled"),
    ];
    const previous = new Map([
      ["existing1", makeStoredEvent("existing1", "Old Event")],
      ["gone1", makeStoredEvent("gone1", "Gone Event")],
    ]);
    const changes = classifyChanges(items, previous);

    expect(changes).toHaveLength(3);
    expect(changes.find((c) => c.item.id === "new1")?.kind).toBe("added");
    expect(changes.find((c) => c.item.id === "existing1")?.kind).toBe("updated");
    expect(changes.find((c) => c.item.id === "gone1")?.kind).toBe("removed");
  });

  it("returns empty array for empty input", () => {
    expect(classifyChanges([], new Map())).toEqual([]);
  });
});
