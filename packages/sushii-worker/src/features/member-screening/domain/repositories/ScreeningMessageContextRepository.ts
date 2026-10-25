export interface CachedMessage {
  messageId: string;
  authorId: string;
  /** Display name, falling back to username, then the id. */
  authorName: string;
  content: string;
  createdAt: Date;
}

/** Reads the shared message cache (`app_public.messages`, 7-day retention). Only Default and Reply messages count; rows without a type count as Default. */
export interface ScreeningMessageContextRepository {
  /** Newest `limit` messages in the channel created strictly before `before`, oldest first. */
  recentInChannel(
    guildId: string,
    channelId: string,
    before: Date,
    limit: number,
  ): Promise<CachedMessage[]>;
  /** Cached messages by the author in the guild with created >= since and < before. */
  countByAuthorSince(
    guildId: string,
    authorId: string,
    since: Date,
    before: Date,
  ): Promise<number>;
}
