export type ScheduleEventStatus = "confirmed" | "cancelled" | "tentative";

export class ScheduleEvent {
  constructor(
    public readonly id: string,
    public readonly summary: string,
    public readonly startUtc: Date | null,
    public readonly startDate: string | null,
    public readonly isAllDay: boolean,
    public readonly url: string | null,
    public readonly location: string | null,
    public readonly status: ScheduleEventStatus,
  ) {}

  /** Returns the effective Date for this event, normalising all-day events to midnight UTC. */
  getDate(): Date | null {
    if (this.isAllDay && this.startDate) {
      return new Date(`${this.startDate}T00:00:00Z`);
    }
    return this.startUtc;
  }
}
