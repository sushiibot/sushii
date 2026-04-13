export interface ScheduleChannel {
  guildId: bigint;
  channelId: bigint;
  logChannelId: bigint;
  configuredByUserId: bigint;
  calendarId: string;
  calendarTitle: string;
  displayTitle: string | null;
  syncToken: string | null;
  pollIntervalSec: number;
  nextPollAt: Date;
  consecutiveFailures: number;
  lastErrorAt: Date | null;
  lastErrorReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
