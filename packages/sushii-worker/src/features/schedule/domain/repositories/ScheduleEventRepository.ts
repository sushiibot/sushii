import type { ScheduleEvent } from "../entities/ScheduleEvent";

export interface ScheduleEventWithCalendar {
  event: ScheduleEvent;
  calendarId: string;
  calendarTitle: string;
  accentColor: number | null;
}

export interface ScheduleEventRepository {
  upsertMany(guildId: bigint, calendarId: string, events: ScheduleEvent[]): Promise<void>;

  deleteByIds(guildId: bigint, calendarId: string, ids: string[]): Promise<void>;

  /** Atomically replaces all stored events for a calendar (delete all + upsert active). */
  replaceAllEvents(guildId: bigint, calendarId: string, events: ScheduleEvent[]): Promise<void>;

  /** Returns events for one calendar within [from, to). */
  findEventsByCalendar(
    guildId: bigint,
    calendarId: string,
    from: Date,
    to: Date,
  ): Promise<ScheduleEvent[]>;

  /**
   * Returns up to `limit` past events across all calendars in a guild.
   * Results are ordered most-recent-first.
   */
  findRecentPastByGuild(
    guildId: bigint,
    before: Date,
    limit: number,
  ): Promise<ScheduleEventWithCalendar[]>;

  /**
   * Returns the next `limit` upcoming events across all calendars in a guild,
   * joined with schedule metadata. No upper date bound — uses LIMIT so it always
   * returns something as long as future events exist.
   */
  findUpcomingByGuild(
    guildId: bigint,
    from: Date,
    limit: number,
  ): Promise<ScheduleEventWithCalendar[]>;
}
