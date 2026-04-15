import { describe, expect, it } from "bun:test";

import type { CalendarEventItem } from "./GoogleCalendarClient";
import { toScheduleEvent } from "./CalendarEventMapper";

function makeItem(overrides: Partial<CalendarEventItem> = {}): CalendarEventItem {
  return {
    id: "evt1",
    status: "confirmed",
    summary: "Test Event",
    ...overrides,
  };
}

describe("toScheduleEvent", () => {
  describe("timed events", () => {
    it("maps a timed event with dateTime to a non-all-day ScheduleEvent", () => {
      const event = toScheduleEvent(
        makeItem({ start: { dateTime: "2024-06-20T10:00:00Z" } }),
      );
      expect(event.isAllDay).toBe(false);
      expect(event.startUtc).toEqual(new Date("2024-06-20T10:00:00Z"));
      expect(event.startDate).toBeNull();
    });

    it("maps a timed event with timezone offset correctly", () => {
      const event = toScheduleEvent(
        makeItem({ start: { dateTime: "2024-06-20T10:00:00+09:00" } }),
      );
      expect(event.isAllDay).toBe(false);
      expect(event.startUtc?.toISOString()).toBe("2024-06-20T01:00:00.000Z");
    });
  });

  describe("all-day events", () => {
    it("maps an all-day event (date only, no dateTime) correctly", () => {
      const event = toScheduleEvent(
        makeItem({ start: { date: "2024-06-20" } }),
      );
      expect(event.isAllDay).toBe(true);
      expect(event.startDate).toBe("2024-06-20");
      expect(event.startUtc).toBeNull();
    });

    it("treats event with both date and dateTime as timed (dateTime wins)", () => {
      // If dateTime is present, isAllDay should be false even if date is also set
      const event = toScheduleEvent(
        makeItem({ start: { date: "2024-06-20", dateTime: "2024-06-20T10:00:00Z" } }),
      );
      expect(event.isAllDay).toBe(false);
      expect(event.startUtc).not.toBeNull();
    });
  });

  describe("summary / title", () => {
    it("uses the summary as-is when present", () => {
      const event = toScheduleEvent(makeItem({ summary: "My Event" }));
      expect(event.summary).toBe("My Event");
    });

    it("falls back to '(no title)' when summary is missing", () => {
      const event = toScheduleEvent(makeItem({ summary: undefined }));
      expect(event.summary).toBe("(no title)");
    });
  });

  describe("optional fields", () => {
    it("maps htmlLink to url", () => {
      const event = toScheduleEvent(
        makeItem({ htmlLink: "https://calendar.google.com/event?eid=abc" }),
      );
      expect(event.url).toBe("https://calendar.google.com/event?eid=abc");
    });

    it("maps location when present", () => {
      const event = toScheduleEvent(makeItem({ location: "Madison Square Garden" }));
      expect(event.location).toBe("Madison Square Garden");
    });

    it("sets url and location to null when absent", () => {
      const event = toScheduleEvent(makeItem({ htmlLink: undefined, location: undefined }));
      expect(event.url).toBeNull();
      expect(event.location).toBeNull();
    });

    it("maps event id and status correctly", () => {
      const event = toScheduleEvent(makeItem({ id: "evt123", status: "tentative" }));
      expect(event.id).toBe("evt123");
      expect(event.status).toBe("tentative");
    });
  });
});
