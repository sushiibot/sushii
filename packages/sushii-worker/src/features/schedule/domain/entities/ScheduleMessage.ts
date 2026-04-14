export interface ScheduleMessage {
  guildId: bigint;
  calendarId: string;
  channelId: bigint;
  year: number;
  month: number;
  messageIndex: number;
  messageId: bigint;
  contentHash: string;
  isArchived: boolean;
  lastUpdatedAt: Date;
}
