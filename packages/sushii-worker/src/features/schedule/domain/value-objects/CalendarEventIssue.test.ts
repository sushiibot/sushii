import { describe, expect, it } from "bun:test";

import type { CalendarEventItem } from "@/features/schedule/infrastructure/google/GoogleCalendarClient";
import { calendarItemIssues } from "./CalendarEventIssue";

function makeItem(overrides: Partial<CalendarEventItem> = {}): CalendarEventItem {
  return {
    id: "evt1",
    status: "confirmed",
    summary: "Normal Event",
    ...overrides,
  };
}

describe("calendarItemIssues", () => {
  it("returns null for a normal public event with a title", () => {
    expect(calendarItemIssues(makeItem())).toBeNull();
  });

  it("returns private issue for private visibility", () => {
    const issue = calendarItemIssues(makeItem({ visibility: "private" }));
    expect(issue?.kind).toBe("private");
  });

  it("returns null for confidential visibility (only 'private' is flagged)", () => {
    // The implementation only checks for exact "private" string
    expect(calendarItemIssues(makeItem({ visibility: "confidential" }))).toBeNull();
  });

  it("returns null for default or public visibility", () => {
    expect(calendarItemIssues(makeItem({ visibility: "default" }))).toBeNull();
    expect(calendarItemIssues(makeItem({ visibility: "public" }))).toBeNull();
  });

  it("returns no_title issue when summary is missing", () => {
    const issue = calendarItemIssues(makeItem({ summary: undefined }));
    expect(issue?.kind).toBe("no_title");
  });

  it("returns no_title issue when summary is empty string", () => {
    const issue = calendarItemIssues(makeItem({ summary: "" }));
    expect(issue?.kind).toBe("no_title");
  });

  it("returns no_title issue when summary is whitespace only", () => {
    const issue = calendarItemIssues(makeItem({ summary: "   " }));
    expect(issue?.kind).toBe("no_title");
  });

  it("private check takes priority over no_title check (visibility checked first)", () => {
    const issue = calendarItemIssues(makeItem({ visibility: "private", summary: undefined }));
    expect(issue?.kind).toBe("private");
  });
});
