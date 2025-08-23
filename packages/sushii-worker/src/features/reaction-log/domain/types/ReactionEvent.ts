export interface ReactionEvent {
  messageId: string;
  channelId: string;
  guildId: string;
  userId: string;
  emojiString: string; // Unicode or <:name:id> format
  emojiName?: string; // Name for custom emojis
  emojiId?: string; // ID for custom emojis
  type: "add" | "remove";
  timestamp: Date;
  isInitial: boolean; // True if this user started this emoji reaction
}

export const BATCH_WINDOW_MS = 30000; // 30 seconds

export interface ReactionBatch {
  messageId: string;
  channelId: string;
  guildId: string;
  actions: ReactionEvent[];
  startTime: Date;
}
