export interface NewMessageLogPost {
  messageId: string;
  guildId: string;
  channelId: string;
  logChannelId: string;
  logMessageId: string;
}

export interface MessageLogPost extends NewMessageLogPost {
  createdAt: Date;
}

/** Which message log post shows each deleted message. */
export interface MessageLogPostRepository {
  /** Upserts on message id; a later post replaces an earlier one. */
  saveMany(rows: NewMessageLogPost[]): Promise<void>;
  findByMessageIds(
    guildId: string,
    messageIds: string[],
  ): Promise<MessageLogPost[]>;
  deleteBefore(date: Date): Promise<number>;
}
