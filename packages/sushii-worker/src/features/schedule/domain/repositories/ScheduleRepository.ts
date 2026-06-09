import type { Schedule } from "../entities/Schedule";

export interface UpdateScheduleSettingsData {
  displayTitle?: string;
  channelId?: bigint;
  logChannelId?: bigint;
  nextPollAt?: Date;
  accentColor?: number | null;
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
  accentColor?: number | null;
}

export interface ScheduleRepository {
  findAllDue(now: Date): Promise<Schedule[]>;

  findByChannel(guildId: bigint, channelId: bigint): Promise<Schedule | null>;

  findByCalendar(guildId: bigint, calendarId: string): Promise<Schedule | null>;

  findAllByGuild(guildId: bigint): Promise<Schedule[]>;

  /**
   * Returns the explicitly-set default schedule for the guild, or falls back to
   * the oldest one by createdAt if none is marked. Returns null if no schedules exist.
   */
  findDefault(guildId: bigint): Promise<Schedule | null>;

  /**
   * Sets the given calendar as the default for the guild, clearing isDefault on
   * all others in the same guild atomically.
   */
  setDefault(guildId: bigint, calendarId: string): Promise<void>;

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

  /** Clears all error state (calendar + Discord) after a fully successful sync. */
  resetFailures(guildId: bigint, calendarId: string): Promise<void>;

  /** Records that the Discord channel was inaccessible. Does not affect calendar failure state. */
  recordDiscordChannelError(guildId: bigint, calendarId: string): Promise<void>;
}
