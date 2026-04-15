export interface Schedule {
  guildId: bigint;
  calendarId: string;
  channelId: bigint;
  logChannelId: bigint;
  configuredByUserId: bigint;
  calendarTitle: string;
  displayTitle: string;
  syncToken: string | null;
  pollIntervalSec: number;
  nextPollAt: Date;
  consecutiveFailures: number;
  lastErrorAt: Date | null;
  lastErrorReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}
