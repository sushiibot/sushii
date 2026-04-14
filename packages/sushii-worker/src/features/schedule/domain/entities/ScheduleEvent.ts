export type ScheduleEventStatus = "confirmed" | "cancelled" | "tentative";

export class ScheduleEvent {
  private readonly _date: Date | null;

  constructor(
    public readonly id: string,
    public readonly summary: string,
    public readonly startUtc: Date | null,
    public readonly startDate: string | null,
    public readonly isAllDay: boolean,
    public readonly url: string | null,
    public readonly location: string | null,
    public readonly status: ScheduleEventStatus,
  ) {
    if (isAllDay && startDate) {
      this._date = new Date(`${startDate}T00:00:00Z`);
    } else {
      this._date = startUtc;
    }
  }

  /** Returns the effective Date for this event, normalising all-day events to midnight UTC. */
  getDate(): Date | null {
    return this._date;
  }
}
