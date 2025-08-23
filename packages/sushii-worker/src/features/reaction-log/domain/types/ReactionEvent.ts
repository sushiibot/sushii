export interface ReactionEvent {
  messageId: string;
  channelId: string;
  guildId: string;
  userId: string;
  emoji: string; // Unicode or <:name:id> format
  emojiName?: string; // Name for custom emojis
  emojiId?: string; // ID for custom emojis
  type: 'add' | 'remove';
  timestamp: Date;
  isInitial: boolean; // True if this user started this emoji reaction
  userName?: string; // Cached username if available
}

export interface ReactionBatch {
  messageId: string;
  channelId: string;
  guildId: string;
  actions: ReactionEvent[];
  startTime: Date;
}