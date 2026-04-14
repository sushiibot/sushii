import type { ScheduleEvent } from "../entities/ScheduleEvent";

export interface ScheduleEventWithCalendar {
  event: ScheduleEvent;
  calendarId: string;
  calendarTitle: string;
}

export interface ScheduleEventRepository {
  upsertMany(guildId: bigint, calendarId: string, events: ScheduleEvent[]): Promise<void>;

  deleteByIds(guildId: bigint, calendarId: string, ids: string[]): Promise<void>;

  /** Returns events for one calendar within [from, to). */
  findEventsByCalendar(
    guildId: bigint,
    calendarId: string,
    from: Date,
    to: Date,
  ): Promise<ScheduleEvent[]>;

  /** Returns all stored events for one calendar (for change detection snapshots). */
  findAllEventsByCalendar(guildId: bigint, calendarId: string): Promise<ScheduleEvent[]>;

  /** Returns upcoming events across all calendars in a guild, joined with schedule metadata. */
  findUpcomingByGuild(
    guildId: bigint,
    from: Date,
    to: Date,
  ): Promise<ScheduleEventWithCalendar[]>;
}
