export interface ScheduleChannelMessage {
  guildId: bigint;
  channelId: bigint;
  year: number;
  month: number;
  messageIndex: number;
  messageId: bigint;
  contentHash: string;
  isArchived: boolean;
  lastUpdatedAt: Date;
}
