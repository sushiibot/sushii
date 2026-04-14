import type { Logger } from "pino";

import type { Schedule } from "../domain/entities/Schedule";
import type { ScheduleEvent } from "../domain/entities/ScheduleEvent";
import type { ScheduleEventRepository } from "../domain/repositories/ScheduleEventRepository";
import type {
  CalendarEventItem,
  GoogleCalendarClient,
} from "../infrastructure/google/GoogleCalendarClient";
import { toScheduleEvent } from "../infrastructure/google/CalendarEventMapper";

// Fetch 2 years ahead on full sync so /schedule always has data
const FULL_FETCH_YEARS_AHEAD = 2;

/**
 * Manages Google Calendar fetching and DB-backed event persistence.
 * Knows nothing about Discord.
 */
export class CalendarSyncService {
  constructor(
    private readonly calendarClient: GoogleCalendarClient,
    private readonly eventRepo: ScheduleEventRepository,
    private readonly logger: Logger,
  ) {}

  /**
   * Full fetch from start of current month → FULL_FETCH_YEARS_AHEAD years ahead.
   * Replaces all stored events for this calendar.
   */
  async fullFetch(
    schedule: Schedule,
    year: number,
    month: number,
  ): Promise<{ items: CalendarEventItem[]; nextSyncToken?: string }> {
    const timeMin = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const timeMax = new Date(
      Date.UTC(year + FULL_FETCH_YEARS_AHEAD, month - 1, 1),
    ).toISOString();

    const result = await this.calendarClient.listEvents(schedule.calendarId, {
      timeMin,
      timeMax,
    });

    const active = result.items.filter((i) => i.status !== "cancelled");
    const cancelled = result.items.filter((i) => i.status === "cancelled");

    await this.eventRepo.upsertMany(
      schedule.guildId,
      schedule.calendarId,
      active.map(toScheduleEvent),
    );

    if (cancelled.length > 0) {
      await this.eventRepo.deleteByIds(
        schedule.guildId,
        schedule.calendarId,
        cancelled.map((i) => i.id),
      );
    }

    return result;
  }

  /**
   * Incremental fetch using the sync token. Applies diff to DB.
   */
  async incrementalFetch(
    schedule: Schedule,
  ): Promise<{ items: CalendarEventItem[]; nextSyncToken?: string }> {
    const result = await this.calendarClient.listEvents(schedule.calendarId, {
      syncToken: schedule.syncToken!,
    });

    const active = result.items.filter((i) => i.status !== "cancelled");
    const cancelled = result.items.filter((i) => i.status === "cancelled");

    if (active.length > 0) {
      await this.eventRepo.upsertMany(
        schedule.guildId,
        schedule.calendarId,
        active.map(toScheduleEvent),
      );
    }

    if (cancelled.length > 0) {
      await this.eventRepo.deleteByIds(
        schedule.guildId,
        schedule.calendarId,
        cancelled.map((i) => i.id),
      );
    }

    return result;
  }

  /**
   * One-off fetch for a specific month without affecting stored events.
   * Used for archive rendering of previous months.
   */
  async fetchMonthEvents(
    calendarId: string,
    year: number,
    month: number,
  ): Promise<ScheduleEvent[]> {
    const timeMin = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const timeMax = new Date(Date.UTC(year, month, 1)).toISOString();
    const result = await this.calendarClient.listEvents(calendarId, {
      timeMin,
      timeMax,
    });
    return result.items
      .filter((i) => i.status !== "cancelled")
      .map(toScheduleEvent);
  }

  /** Snapshot of all stored events for a calendar, used for change detection. */
  async getPreviousEvents(
    guildId: bigint,
    calendarId: string,
  ): Promise<Map<string, ScheduleEvent>> {
    const events = await this.eventRepo.findAllEventsByCalendar(guildId, calendarId);
    return new Map(events.map((e) => [e.id, e]));
  }
}
