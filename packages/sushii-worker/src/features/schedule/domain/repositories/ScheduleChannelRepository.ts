import type { ScheduleChannel } from "../entities/ScheduleChannel";
import type { ScheduleChannelMessage } from "../entities/ScheduleChannelMessage";

export interface UpsertScheduleChannelData {
  guildId: bigint;
  channelId: bigint;
  logChannelId: bigint;
  configuredByUserId: bigint;
  calendarId: string;
  calendarTitle: string;
  displayTitle: string | null;
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

  getMessages(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
  ): Promise<ScheduleChannelMessage[]>;

  upsertMessage(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
    messageIndex: number,
    messageId: bigint,
    contentHash: string,
  ): Promise<void>;

  deleteMessagesAboveIndex(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
    maxIndex: number,
  ): Promise<void>;

  markArchived(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
  ): Promise<void>;

  clearContentHashes(
    guildId: bigint,
    channelId: bigint,
    year: number,
    month: number,
  ): Promise<void>;
}
