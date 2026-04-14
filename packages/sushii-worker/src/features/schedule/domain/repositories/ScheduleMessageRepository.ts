import type { ScheduleMessage } from "../entities/ScheduleMessage";

export interface ScheduleMessageRepository {
  getMessages(
    guildId: bigint,
    calendarId: string,
    year: number,
    month: number,
  ): Promise<ScheduleMessage[]>;

  upsertMessage(
    guildId: bigint,
    calendarId: string,
    channelId: bigint,
    year: number,
    month: number,
    messageIndex: number,
    messageId: bigint,
    contentHash: string,
  ): Promise<void>;

  deleteMessagesAboveIndex(
    guildId: bigint,
    calendarId: string,
    year: number,
    month: number,
    maxIndex: number,
  ): Promise<void>;

  markArchived(
    guildId: bigint,
    calendarId: string,
    year: number,
    month: number,
  ): Promise<void>;

  clearContentHashes(
    guildId: bigint,
    calendarId: string,
    year: number,
    month: number,
  ): Promise<void>;
}
