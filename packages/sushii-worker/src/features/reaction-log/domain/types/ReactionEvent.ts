export interface ReactionEvent {
  messageId: string;
  channelId: string;
  guildId: string;
  userId: string;
  emojiString: string; // Unicode or <:name:id> format (for display)
  emojiName?: string; // Name for custom emojis
  emojiId: string; // ID for custom emojis or unicode string for native emojis
  type: "add" | "remove";
  timestamp: Date;
  isInitial: boolean; // True if this user started this emoji reaction
  allStarters?: string[]; // All users who started this emoji reaction (ordered chronologically)
}

export const BATCH_WINDOW_MS = 60000; // 60 seconds

export interface GuildReactionBatch {
  guildId: string;
  removals: Map<string, ReactionEvent[]>; // messageId -> removal events
  startTime: Date;
}
