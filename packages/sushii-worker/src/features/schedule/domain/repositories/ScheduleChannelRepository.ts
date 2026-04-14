import type { ScheduleChannel } from "../entities/ScheduleChannel";

export interface UpsertScheduleChannelData {
  guildId: bigint;
  channelId: bigint;
  logChannelId: bigint;
  configuredByUserId: bigint;
  calendarId: string;
  calendarTitle: string;
  displayTitle?: string | null;
  pollIntervalSec?: number;
  nextPollAt: Date;
}

export interface ScheduleChannelRepository {
  findAllDue(now: Date): Promise<ScheduleChannel[]>;

  findByChannel(
    guildId: bigint,
    channelId: bigint,
  ): Promise<ScheduleChannel | null>;

  findAllByGuild(guildId: bigint): Promise<ScheduleChannel[]>;

  upsert(data: UpsertScheduleChannelData): Promise<ScheduleChannel>;

  delete(guildId: bigint, channelId: bigint): Promise<void>;

  updateSyncToken(
    guildId: bigint,
    channelId: bigint,
    syncToken: string | null,
    nextPollAt: Date,
  ): Promise<void>;

  recordFailure(
    guildId: bigint,
    channelId: bigint,
    reason: string,
    nextPollAt: Date,
  ): Promise<void>;

  resetFailures(
    guildId: bigint,
    channelId: bigint,
    nextPollAt: Date,
  ): Promise<void>;

  resetFailuresAndUpdateToken(
    guildId: bigint,
    channelId: bigint,
    syncToken: string | null,
    nextPollAt: Date,
  ): Promise<void>;
}
