import { describe, expect, it } from "bun:test";

import { parseCalendarId } from "./CalendarIdParser";

describe("parseCalendarId", () => {
  it("parses share link with base64 cid param", () => {
    const calId = "example@group.calendar.google.com";
    const encoded = btoa(calId);
    const url = `https://calendar.google.com/calendar/u/0?cid=${encoded}`;

    expect(parseCalendarId(url)).toBe(calId);
  });

  it("parses iCal URL format", () => {
    const calId = "example%40group.calendar.google.com";
    const url = `https://calendar.google.com/calendar/ical/${calId}/public/basic.ics`;

    expect(parseCalendarId(url)).toBe("example@group.calendar.google.com");
  });

  it("parses embed URL format", () => {
    const calId = "example@group.calendar.google.com";
    const encoded = encodeURIComponent(calId);
    const url = `https://calendar.google.com/calendar/embed?src=${encoded}`;

    expect(parseCalendarId(url)).toBe(calId);
  });

  it("accepts raw calendar ID with @", () => {
    const calId = "abc123@group.calendar.google.com";

    expect(parseCalendarId(calId)).toBe(calId);
  });

  it("accepts raw gmail-based calendar ID", () => {
    const calId = "user@gmail.com";

    expect(parseCalendarId(calId)).toBe(calId);
  });

  it("returns null for unrecognized URL", () => {
    expect(parseCalendarId("https://example.com/not-a-calendar")).toBeNull();
  });

  it("returns null for plain text without @", () => {
    expect(parseCalendarId("not-a-calendar-id")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCalendarId("")).toBeNull();
  });
});
