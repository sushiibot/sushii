import type { Schedule } from "../entities/Schedule";

export interface UpdateScheduleSettingsData {
  displayTitle?: string;
  channelId?: bigint;
  logChannelId?: bigint;
  nextPollAt?: Date;
}

export interface UpsertScheduleData {
  guildId: bigint;
  calendarId: string;
  channelId: bigint;
  logChannelId: bigint;
  configuredByUserId: bigint;
  calendarTitle: string;
  displayTitle: string;
  pollIntervalSec?: number;
  nextPollAt: Date;
}

export interface ScheduleRepository {
  findAllDue(now: Date): Promise<Schedule[]>;

  findByChannel(guildId: bigint, channelId: bigint): Promise<Schedule | null>;

  findByCalendar(guildId: bigint, calendarId: string): Promise<Schedule | null>;

  findAllByGuild(guildId: bigint): Promise<Schedule[]>;

  upsert(data: UpsertScheduleData): Promise<Schedule>;

  delete(guildId: bigint, calendarId: string): Promise<void>;

  updateSettings(guildId: bigint, calendarId: string, data: UpdateScheduleSettingsData): Promise<Schedule>;

  updateSyncToken(
    guildId: bigint,
    calendarId: string,
    syncToken: string | null,
    nextPollAt: Date,
  ): Promise<void>;

  recordFailure(
    guildId: bigint,
    calendarId: string,
    reason: string,
    nextPollAt: Date,
  ): Promise<void>;

  resetFailuresAndUpdateToken(
    guildId: bigint,
    calendarId: string,
    syncToken: string | null,
    nextPollAt: Date,
  ): Promise<void>;
}
