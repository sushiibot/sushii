import type { Logger } from "pino";

import type { ScheduleChannel } from "../domain/entities/ScheduleChannel";
import type { ScheduleEvent } from "../domain/entities/ScheduleEvent";
import type {
  CalendarEventItem,
  GoogleCalendarClient,
} from "../infrastructure/google/GoogleCalendarClient";
import { toScheduleEvent } from "../infrastructure/google/CalendarEventMapper";

function sortEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => {
    const aTime = a.getDate()?.getTime() ?? 0;
    const bTime = b.getDate()?.getTime() ?? 0;
    return aTime - bTime;
  });
}

/**
 * Manages in-memory Google Calendar event cache and fetching.
 * Knows nothing about Discord.
 */
export class CalendarSyncService {
  private readonly cache = new Map<string, ScheduleEvent[]>();

  constructor(
    private readonly calendarClient: GoogleCalendarClient,
    private readonly logger: Logger,
  ) {}

  private cacheKey(channel: ScheduleChannel): string {
    return `${channel.guildId}:${channel.channelId}`;
  }

  clearCache(channel: ScheduleChannel): void {
    this.cache.delete(this.cacheKey(channel));
  }

  hasCached(channel: ScheduleChannel): boolean {
    return this.cache.has(this.cacheKey(channel));
  }

  getCachedEvents(channel: ScheduleChannel): ScheduleEvent[] {
    return this.cache.get(this.cacheKey(channel)) ?? [];
  }

  applyDiff(channel: ScheduleChannel, changedItems: CalendarEventItem[]): void {
    const key = this.cacheKey(channel);
    const existing = this.cache.get(key) ?? [];
    const eventMap = new Map(existing.map((e) => [e.id, e]));

    for (const item of changedItems) {
      if (item.status === "cancelled") {
        eventMap.delete(item.id);
      } else {
        eventMap.set(item.id, toScheduleEvent(item));
      }
    }

    this.cache.set(key, sortEvents(Array.from(eventMap.values())));
  }

  /**
   * Full fetch for a specific month. Replaces the entire cache for this channel
   * with the fetched events.
   */
  async fullFetch(
    channel: ScheduleChannel,
    year: number,
    month: number,
  ): Promise<{ items: CalendarEventItem[]; nextSyncToken?: string }> {
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const endOfMonth = new Date(Date.UTC(year, month, 1)).toISOString();
    const result = await this.calendarClient.listEvents(channel.calendarId, {
      timeMin: startOfMonth,
      timeMax: endOfMonth,
    });
    this.cache.set(
      this.cacheKey(channel),
      sortEvents(
        result.items
          .filter((i) => i.status !== "cancelled")
          .map(toScheduleEvent),
      ),
    );
    return result;
  }

  /**
   * Fetch events for an arbitrary month without touching the cache.
   * Used for archive rendering of previous months.
   * Throws on API error — callers should catch and decide what to do.
   */
  async fetchMonthEvents(
    calendarId: string,
    year: number,
    month: number,
  ): Promise<ScheduleEvent[]> {
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const endOfMonth = new Date(Date.UTC(year, month, 1)).toISOString();
    const result = await this.calendarClient.listEvents(calendarId, {
      timeMin: startOfMonth,
      timeMax: endOfMonth,
    });
    return sortEvents(
      result.items
        .filter((i) => i.status !== "cancelled")
        .map(toScheduleEvent),
    );
  }

  /**
   * Incremental fetch using a sync token. Applies the diff to the cache and
   * trims to the current month window.
   */
  async incrementalFetch(
    channel: ScheduleChannel,
    year: number,
    month: number,
  ): Promise<{ items: CalendarEventItem[]; nextSyncToken?: string }> {
    const result = await this.calendarClient.listEvents(channel.calendarId, {
      syncToken: channel.syncToken!,
    });
    this.applyDiff(channel, result.items);
    // Trim cache to current month only
    const key = this.cacheKey(channel);
    const cached = this.cache.get(key) ?? [];
    this.cache.set(
      key,
      cached.filter((e) => {
        const d = e.getDate();
        if (!d) return false;
        return d.getUTCFullYear() === year && d.getUTCMonth() + 1 === month;
      }),
    );
    return result;
  }
}
