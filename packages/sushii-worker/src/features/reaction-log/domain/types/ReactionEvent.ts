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

export const BATCH_WINDOW_MS = 60000; // 60 seconds

export interface GuildReactionBatch {
  guildId: string;
  removals: Map<string, ReactionEvent[]>; // messageId -> removal events
  startTime: Date;
}
