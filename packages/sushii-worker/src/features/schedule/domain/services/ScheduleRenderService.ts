import {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  time,
  TimestampStyles,
} from "discord.js";

import type { ScheduleEvent } from "../entities/ScheduleEvent";

export interface MessageChunk {
  container: ContainerBuilder;
  hash: string;
}

type RenderSegment =
  | { type: "text"; content: string }
  | { type: "separator" };

const MAX_TEXT_DISPLAY_CHARS = 3800;
const FOOTER_TEXT = "-# All times are shown in your local timezone";

function formatEventLine(event: ScheduleEvent, isNextUpcoming: boolean): string {
  let summaryText: string;

  if (event.location) {
    try {
      new URL(event.location);
      const escapedSummary = event.summary.replace(/[\[\]]/g, '\\$&');
      const safeLocation = event.location.replace(/\)/g, '%29');
      summaryText = `[${escapedSummary}](${safeLocation})`;
    } catch {
      summaryText = event.summary;
    }
  } else {
    summaryText = event.summary;
  }

  let timePart: string;
  if (event.isAllDay && event.startDate) {
    // Parse YYYY-MM-DD at midnight UTC
    const d = new Date(`${event.startDate}T00:00:00Z`);
    timePart = time(d, TimestampStyles.LongDate);
  } else if (event.startUtc) {
    timePart = time(event.startUtc, TimestampStyles.ShortDateTime);
  } else {
    timePart = "";
  }

  const line = timePart ? `${timePart} ${summaryText}` : summaryText;

  if (isNextUpcoming) {
    return `➡️ **${line}**`;
  }

  return line;
}

function buildSegments(
  events: ScheduleEvent[],
  mode: "live" | "archive",
  now: Date,
): RenderSegment[] {
  const confirmed = events.filter((e) => e.status !== "cancelled");

  if (mode === "archive") {
    if (confirmed.length === 0) return [];
    return [{ type: "text", content: confirmed.map((e) => formatEventLine(e, false)).join("\n") }];
  }

  // Live mode: split into past and upcoming
  const past: ScheduleEvent[] = [];
  const upcoming: ScheduleEvent[] = [];

  const todayDate = now.toISOString().slice(0, 10);

  for (const event of confirmed) {
    let isPast: boolean;
    if (event.isAllDay) {
      // For all-day events, compare dates only — an event on today is not past
      isPast = !!event.startDate && event.startDate < todayDate;
    } else {
      isPast = !!event.startUtc && event.startUtc < now;
    }

    if (isPast) {
      past.push(event);
    } else {
      upcoming.push(event);
    }
  }

  const segments: RenderSegment[] = [];

  if (past.length > 0) {
    segments.push({ type: "text", content: past.map((e) => formatEventLine(e, false)).join("\n") });
  }

  if (past.length > 0 && upcoming.length > 0) {
    segments.push({ type: "separator" });
  }

  if (upcoming.length > 0) {
    segments.push({ type: "text", content: upcoming.map((e, i) => formatEventLine(e, i === 0)).join("\n") });
  }

  return segments;
}

/**
 * Pure render function: converts events to Discord Components v2 message chunks.
 */
export function renderSchedule(
  events: ScheduleEvent[],
  mode: "live" | "archive",
  title: string,
  now: Date,
): MessageChunk[] {
  const safeTitle = title.replace(/\*/g, '\\*');
  const header = `**${safeTitle} 🗓️**`;
  const segments = buildSegments(events, mode, now);

  if (segments.length === 0) {
    const content = `${header}\n\n*No events this month.*\n\n${FOOTER_TEXT}`;
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    const hash = Bun.hash.xxHash64(content).toString(16);
    return [{ container, hash }];
  }

  // Inject header into first text segment and footer into last text segment
  const firstTextIdx = segments.findIndex((s) => s.type === "text");
  const lastTextIdx = segments.findLastIndex((s) => s.type === "text");

  const enrichedSegments: RenderSegment[] = segments.map((seg, i) => {
    if (seg.type !== "text") return seg;

    let content = seg.content;
    if (i === firstTextIdx) content = `${header}\n${content}`;
    if (i === lastTextIdx) content = `${content}\n\n${FOOTER_TEXT}`;
    return { type: "text", content };
  });

  // Pack segments into chunks
  const chunks: MessageChunk[] = [];
  let currentContainer = new ContainerBuilder();
  let currentLines: string[] = [];
  let currentLen = 0;
  let rawParts: string[] = [];

  function flushTextToContainer(): void {
    if (currentLines.length === 0) return;
    const textContent = currentLines.join("\n");
    currentContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(textContent),
    );
    rawParts.push(textContent);
    currentLines = [];
    currentLen = 0;
  }

  function finalizeChunk(): void {
    flushTextToContainer();
    const raw = rawParts.join("\n");
    const hash = Bun.hash.xxHash64(raw).toString(16);
    chunks.push({ container: currentContainer, hash });
    currentContainer = new ContainerBuilder();
    rawParts = [];
  }

  for (const segment of enrichedSegments) {
    if (segment.type === "separator") {
      flushTextToContainer();
      currentContainer.addSeparatorComponents(new SeparatorBuilder());
      // Hash includes text content and separator positions ("---" marks).
      // If separator rendering changes, update this hash format too to force re-render.
      rawParts.push("---");
      continue;
    }

    // Text segment — pack lines, splitting into new chunks when over the limit
    const lines = segment.content.split("\n");

    for (const line of lines) {
      const addLen = currentLines.length > 0 ? 1 + line.length : line.length;

      if (currentLen + addLen > MAX_TEXT_DISPLAY_CHARS) {
        // Flush and start a new chunk
        finalizeChunk();
      }

      currentLines.push(line);
      currentLen += addLen;
    }
  }

  // Finalize the last chunk
  if (currentLines.length > 0 || rawParts.length > 0) {
    finalizeChunk();
  }

  return chunks;
}
