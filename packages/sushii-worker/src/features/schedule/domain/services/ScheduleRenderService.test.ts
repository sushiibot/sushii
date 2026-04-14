import { describe, expect, it } from "bun:test";
import type { APIComponentInContainer, APITextDisplayComponent } from "discord-api-types/v10";
import { ComponentType } from "discord-api-types/v10";

import { ScheduleEvent } from "../entities/ScheduleEvent";
import { renderSchedule } from "./ScheduleRenderService";
import type { MessageChunk } from "./ScheduleRenderService";

const NOW = new Date("2024-06-15T12:00:00Z");
const YEAR = 2024;
const MONTH = 6;

type ScheduleEventOpts = {
  startDate?: string | null;
  isAllDay?: boolean;
  url?: string | null;
  location?: string | null;
  status?: ScheduleEvent["status"];
};

function makeEvent(
  id: string,
  summary: string,
  startUtc: Date | null,
  opts: ScheduleEventOpts = {},
): ScheduleEvent {
  return new ScheduleEvent(
    id,
    summary,
    startUtc,
    opts.startDate ?? null,
    opts.isAllDay ?? false,
    opts.url ?? null,
    opts.location ?? null,
    opts.status ?? "confirmed",
  );
}

function makeAllDayEvent(id: string, summary: string, startDate: string): ScheduleEvent {
  return new ScheduleEvent(id, summary, null, startDate, true, null, null, "confirmed");
}

function getComponents(chunk: MessageChunk): APIComponentInContainer[] {
  return chunk.container.toJSON().components ?? [];
}

function getTextContent(chunks: MessageChunk[]): string {
  return chunks
    .flatMap((chunk) =>
      getComponents(chunk)
        .filter((c): c is APITextDisplayComponent => c.type === ComponentType.TextDisplay)
        .map((c) => c.content),
    )
    .join("\n");
}

function countSeparators(chunk: MessageChunk): number {
  return getComponents(chunk).filter((c) => c.type === ComponentType.Separator).length;
}

function getChunkTextContent(chunk: MessageChunk): string {
  return getComponents(chunk)
    .filter((c): c is APITextDisplayComponent => c.type === ComponentType.TextDisplay)
    .map((c) => c.content)
    .join("\n");
}

describe("renderSchedule", () => {
  describe("live mode", () => {
    it("places separator between past and upcoming events", () => {
      const pastEvent = makeEvent("1", "Past Event", new Date("2024-06-10T10:00:00Z"));
      const upcomingEvent = makeEvent("2", "Upcoming Event", new Date("2024-06-20T10:00:00Z"));

      const chunks = renderSchedule([pastEvent, upcomingEvent], "live", "Test Calendar", YEAR, MONTH, NOW);

      // 1 separator between past/upcoming + 1 footer separator
      expect(countSeparators(chunks[0])).toBe(2);
    });

    it("renders all upcoming events without any special marker", () => {
      const pastEvent = makeEvent("1", "Past Event", new Date("2024-06-10T10:00:00Z"));
      const upcoming1 = makeEvent("2", "First Upcoming", new Date("2024-06-20T10:00:00Z"));
      const upcoming2 = makeEvent("3", "Second Upcoming", new Date("2024-06-25T10:00:00Z"));

      const chunks = renderSchedule([pastEvent, upcoming1, upcoming2], "live", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);

      expect(allText).toContain("First Upcoming");
      expect(allText).toContain("Second Upcoming");
      expect(allText).not.toContain("➡️");
    });

    it("shows no past/upcoming separator when all events are past", () => {
      const past1 = makeEvent("1", "Past 1", new Date("2024-06-01T10:00:00Z"));
      const past2 = makeEvent("2", "Past 2", new Date("2024-06-05T10:00:00Z"));

      const chunks = renderSchedule([past1, past2], "live", "Test Calendar", YEAR, MONTH, NOW);

      // Only footer separator
      expect(countSeparators(chunks[0])).toBe(1);
    });

    it("shows no past/upcoming separator when all events are upcoming", () => {
      const up1 = makeEvent("1", "Upcoming 1", new Date("2024-06-20T10:00:00Z"));
      const up2 = makeEvent("2", "Upcoming 2", new Date("2024-06-25T10:00:00Z"));

      const chunks = renderSchedule([up1, up2], "live", "Test Calendar", YEAR, MONTH, NOW);

      // Only footer separator
      expect(countSeparators(chunks[0])).toBe(1);
    });

    it("does not show -# Past or -# Upcoming labels", () => {
      const pastEvent = makeEvent("1", "Past Event", new Date("2024-06-10T10:00:00Z"));
      const upcomingEvent = makeEvent("2", "Upcoming Event", new Date("2024-06-20T10:00:00Z"));

      const chunks = renderSchedule([pastEvent, upcomingEvent], "live", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);

      expect(allText).not.toMatch(/^-# Past$/m);
      expect(allText).not.toMatch(/^-# Upcoming$/m);
    });
  });

  describe("archive mode", () => {
    it("renders a flat plain list with only the footer separator", () => {
      const past = makeEvent("1", "Past Event", new Date("2024-05-10T10:00:00Z"));
      const upcoming = makeEvent("2", "Future Event", new Date("2024-07-20T10:00:00Z"));

      const chunks = renderSchedule([past, upcoming], "archive", "Test Calendar", YEAR, MONTH, NOW);

      expect(countSeparators(chunks[0])).toBe(1);
      expect(getTextContent(chunks)).not.toContain("➡️");
    });

    it("excludes cancelled events", () => {
      const confirmed = makeEvent("1", "Confirmed", new Date("2024-06-20T10:00:00Z"));
      const cancelled = makeEvent("2", "Cancelled", new Date("2024-06-22T10:00:00Z"), { status: "cancelled" });

      const chunks = renderSchedule([confirmed, cancelled], "archive", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);

      expect(allText).toContain("Confirmed");
      expect(allText).not.toContain("Cancelled");
    });

    it("footer contains '· archived' in archive mode", () => {
      const event = makeEvent("1", "Event", new Date("2024-06-20T10:00:00Z"));
      const chunks = renderSchedule([event], "archive", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);

      expect(allText).toContain("· archived");
    });
  });

  describe("chunk splitting", () => {
    it("splits into multiple chunks when content exceeds 3800 chars", () => {
      const longSummary = "A".repeat(200);
      const events = Array.from({ length: 30 }, (_, i) =>
        makeEvent(
          String(i),
          `${longSummary} ${i}`,
          new Date(`2024-06-${(i % 20) + 1}T10:00:00Z`),
        ),
      );

      const chunks = renderSchedule(events, "archive", "Test Calendar", YEAR, MONTH, NOW);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it("each chunk hash is deterministic", () => {
      const events = [
        makeEvent("1", "Event A", new Date("2024-06-20T10:00:00Z")),
        makeEvent("2", "Event B", new Date("2024-06-25T10:00:00Z")),
      ];

      const chunks1 = renderSchedule(events, "live", "Test Calendar", YEAR, MONTH, NOW);
      const chunks2 = renderSchedule(events, "live", "Test Calendar", YEAR, MONTH, NOW);

      for (let i = 0; i < chunks1.length; i++) {
        expect(chunks1[i].hash).toBe(chunks2[i].hash);
      }
    });
  });

  describe("event formatting", () => {
    it("all-day event on today is classified as upcoming, not past", () => {
      // NOW is 2024-06-15T12:00:00Z — midnight UTC of 2024-06-15 is before NOW,
      // but the event is happening today so it must NOT be classified as past.
      const todayAllDay = makeAllDayEvent("1", "Today Event", "2024-06-15");
      const chunks = renderSchedule([todayAllDay], "live", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);
      // Should appear as upcoming with only footer separator (no past/upcoming separator)
      expect(allText).toContain("Today Event");
      expect(countSeparators(chunks[0])).toBe(1);
    });

    it("all-day event in the past is classified as past", () => {
      const pastAllDay = makeAllDayEvent("1", "Past All Day", "2024-06-14");
      const futureAllDay = makeAllDayEvent("2", "Future All Day", "2024-06-20");
      const chunks = renderSchedule([pastAllDay, futureAllDay], "live", "Test Calendar", YEAR, MONTH, NOW);
      // 1 separator between past/upcoming + 1 footer separator
      expect(countSeparators(chunks[0])).toBe(2);
    });

    it("uses d timestamp style for all-day events", () => {
      const allDay = makeAllDayEvent("1", "All Day Event", "2024-06-20");
      const chunks = renderSchedule([allDay], "live", "Test Calendar", YEAR, MONTH, NOW);
      expect(getTextContent(chunks)).toMatch(/<t:\d+:d>/);
    });

    it("uses f (ShortDateTime) timestamp style for timed events", () => {
      const timed = makeEvent("1", "Timed Event", new Date("2024-06-20T10:00:00Z"));
      const chunks = renderSchedule([timed], "live", "Test Calendar", YEAR, MONTH, NOW);
      const text = getTextContent(chunks);
      expect(text).toMatch(/<t:\d+:f>/);
      expect(text).not.toMatch(/<t:\d+:d>/);
      expect(text).not.toMatch(/<t:\d+:t>/);
    });

    it("renders URL location as hyperlink", () => {
      const event = makeEvent("1", "Event", new Date("2024-06-20T10:00:00Z"), {
        location: "https://example.com/stream",
      });
      const chunks = renderSchedule([event], "live", "Test Calendar", YEAR, MONTH, NOW);
      expect(getTextContent(chunks)).toContain("[Event](https://example.com/stream)");
    });

    it("escapes ] in summary when rendering as hyperlink", () => {
      const event = makeEvent("1", "Event [Special]", new Date("2024-06-20T10:00:00Z"), {
        location: "https://example.com/stream",
      });
      const chunks = renderSchedule([event], "live", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);
      expect(allText).toContain("[Event \\[Special\\]](https://example.com/stream)");
    });

    it("encodes ) in location URL to prevent markdown injection", () => {
      const event = makeEvent("1", "Event", new Date("2024-06-20T10:00:00Z"), {
        location: "https://x.com/watch?v=abc123)",
      });
      const chunks = renderSchedule([event], "live", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);
      // The ) should be encoded as %29 so it does not terminate the markdown link early
      expect(allText).toContain("[Event](https://x.com/watch?v=abc123%29)");
      expect(allText).not.toContain("https://x.com/watch?v=abc123)");
    });

    it("ignores non-URL location", () => {
      const event = makeEvent("1", "Event", new Date("2024-06-20T10:00:00Z"), {
        location: "Madison Square Garden, New York",
      });
      const chunks = renderSchedule([event], "live", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);
      expect(allText).toContain("Event");
      expect(allText).not.toContain("Madison Square Garden");
      expect(allText).not.toContain("[Event]");
    });
  });

  describe("header and footer", () => {
    it("includes header on first chunk only", () => {
      const longSummary = "A".repeat(200);
      const events = Array.from({ length: 30 }, (_, i) =>
        makeEvent(String(i), `${longSummary} ${i}`, new Date(`2024-06-${(i % 20) + 1}T10:00:00Z`)),
      );

      const chunks = renderSchedule(events, "archive", "Test Calendar", YEAR, MONTH, NOW);
      expect(chunks.length).toBeGreaterThan(1);

      const firstText = getChunkTextContent(chunks[0]);

      expect(firstText).toContain("## June 2024");

      for (let i = 1; i < chunks.length; i++) {
        const text = getChunkTextContent(chunks[i]);
        expect(text).not.toContain("## June 2024");
      }
    });

    it("includes footer on last chunk only", () => {
      const longSummary = "A".repeat(200);
      const events = Array.from({ length: 30 }, (_, i) =>
        makeEvent(String(i), `${longSummary} ${i}`, new Date(`2024-06-${(i % 20) + 1}T10:00:00Z`)),
      );

      const chunks = renderSchedule(events, "archive", "Test Calendar", YEAR, MONTH, NOW);
      expect(chunks.length).toBeGreaterThan(1);

      const lastText = getChunkTextContent(chunks.at(-1)!);

      expect(lastText).toContain("All times are shown in your local timezone");
    });

    it("header with title uses ## month/year heading and title as subheading", () => {
      const event = makeEvent("1", "Event", new Date("2024-01-20T10:00:00Z"));
      const chunks = renderSchedule([event], "live", "Title", 2024, 1, new Date("2024-01-10T12:00:00Z"));
      const allText = getTextContent(chunks);

      expect(allText).toContain("## January 2024");
      expect(allText).toContain("-# Title");
    });

    it("header without title (null) shows ## month/year only", () => {
      const event = makeEvent("1", "Event", new Date("2024-01-20T10:00:00Z"));
      const chunks = renderSchedule([event], "live", null, 2024, 1, new Date("2024-01-10T12:00:00Z"));
      const allText = getTextContent(chunks);

      expect(allText).toContain("## January 2024");
      expect(allText).not.toContain("-# January 2024");
    });

    it("header without title (null) and no events shows ## month/year with empty-state message", () => {
      const chunks = renderSchedule([], "live", null, YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);

      expect(chunks.length).toBe(1);
      expect(allText).toContain(`## June ${YEAR}`);
      expect(allText).toContain("*No events this month.*");
    });

    it("live mode footer does not contain '· archived'", () => {
      const event = makeEvent("1", "Event", new Date("2024-06-20T10:00:00Z"));
      const chunks = renderSchedule([event], "live", "Test Calendar", YEAR, MONTH, NOW);
      const allText = getTextContent(chunks);

      expect(allText).toContain("All times are shown in your local timezone");
      expect(allText).not.toContain("· archived");
    });
  });
});
