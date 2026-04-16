import {
  ContainerBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
} from "discord.js";

import type { ScheduleEvent } from "@/features/schedule/domain/entities/ScheduleEvent";
import { formatEventTimestamp } from "./ScheduleFormatting";

export interface MessageChunk {
  container: ContainerBuilder;
  hash: string;
}

type RenderSegment =
  | { type: "text"; content: string }
  | { type: "separator" };

const MAX_TEXT_DISPLAY_CHARS = 3800;
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const FOOTER_TEXT_LIVE = "-# All times are shown in your local timezone";
const FOOTER_TEXT_ARCHIVE = "-# All times are shown in your local timezone · archived";

function formatEventLine(event: ScheduleEvent): string {
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

  const timePart = formatEventTimestamp(event);

  let line = timePart ? `${timePart} — ${summaryText}` : summaryText;

  const MAX_LINE_LENGTH = MAX_TEXT_DISPLAY_CHARS - 50;
  if (line.length > MAX_LINE_LENGTH) {
    line = line.slice(0, MAX_LINE_LENGTH) + "…";
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
    return [{ type: "text", content: confirmed.map((e) => formatEventLine(e)).join("\n") }];
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

  const hasBoth = past.length > 0 && upcoming.length > 0;

  if (past.length > 0) {
    const content = (hasBoth ? "\n-# Past Events\n" : "") + past.map((e) => formatEventLine(e)).join("\n");
    segments.push({ type: "text", content });
  }

  if (hasBoth) {
    segments.push({ type: "separator" });
  }

  if (upcoming.length > 0) {
    const content = (hasBoth ? "-# Upcoming Events\n" : "") + upcoming.map((e) => formatEventLine(e)).join("\n");
    segments.push({ type: "text", content });
  }

  return segments;
}

/**
 * Pure render function: converts events to Discord Components v2 message chunks.
 */
export function renderSchedule(
  events: ScheduleEvent[],
  mode: "live" | "archive",
  title: string | null,
  year: number,
  month: number,
  now: Date,
  accentColor?: number | null,
): MessageChunk[] {
  const monthYearStr = MONTH_YEAR_FORMAT.format(new Date(year, month - 1));

  let header: string;
  if (title !== null) {
    const safeTitle = title.replace(/[#*_~`]/g, '\\$&');
    header = `## ${safeTitle} - ${monthYearStr}`;
  } else {
    header = `## ${monthYearStr}`;
  }

  const footerText = mode === "archive" ? FOOTER_TEXT_ARCHIVE : FOOTER_TEXT_LIVE;

  const segments = buildSegments(events, mode, now);

  if (segments.length === 0) {
    const content = `${header}\n\n*No events this month.*`;
    const container = new ContainerBuilder();
    if (accentColor != null) container.setAccentColor(accentColor);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText));
    const colorKey = accentColor != null ? `|c:${accentColor}` : "";
    const hash = Bun.hash.xxHash64(content + "---" + footerText + colorKey).toString(16);
    return [{ container, hash }];
  }

  // Inject header into first text segment
  const firstTextIdx = segments.findIndex((s) => s.type === "text");

  const enrichedSegments: RenderSegment[] = segments.map((seg, i) => {
    if (seg.type !== "text") return seg;

    let content = seg.content;
    if (i === firstTextIdx) content = `${header}\n${content}`;
    return { type: "text", content };
  });

  // Add separator + footer as the final segments
  enrichedSegments.push({ type: "separator" });
  enrichedSegments.push({ type: "text", content: footerText });

  // Pack segments into chunks
  function makeContainer(): ContainerBuilder {
    const c = new ContainerBuilder();
    if (accentColor != null) c.setAccentColor(accentColor);
    return c;
  }

  const chunks: MessageChunk[] = [];
  let currentContainer = makeContainer();
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

  const colorKey = accentColor != null ? `|c:${accentColor}` : "";

  function finalizeChunk(): void {
    flushTextToContainer();
    const raw = rawParts.join("\n");
    const hash = Bun.hash.xxHash64(raw + colorKey).toString(16);
    chunks.push({ container: currentContainer, hash });
    currentContainer = makeContainer();
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
