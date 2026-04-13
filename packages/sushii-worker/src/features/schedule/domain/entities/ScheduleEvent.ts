export type ScheduleEventStatus = "confirmed" | "cancelled" | "tentative";

export interface ScheduleEvent {
  id: string;
  summary: string;
  startUtc: Date | null;
  startDate: string | null;
  isAllDay: boolean;
  url: string | null;
  location: string | null;
  status: ScheduleEventStatus;
}
