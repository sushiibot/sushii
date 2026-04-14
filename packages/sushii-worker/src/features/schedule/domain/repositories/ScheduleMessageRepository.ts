import type { ScheduleChannelMessage } from "../entities/ScheduleChannelMessage";

export interface ScheduleMessageRepository {
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
