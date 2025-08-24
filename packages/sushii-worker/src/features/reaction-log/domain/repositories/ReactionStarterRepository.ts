export interface ReactionStarterRepository {
  /**
   * Save who started a reaction for a specific emoji on a message
   * Uses onConflictDoNothing to handle race conditions
   */
  saveStarter(
    messageId: string,
    emoji: string,
    userId: string,
    guildId: string,
  ): Promise<void>;

  /**
   * Get who started a reaction for a specific emoji on a message
   * Returns null if no starter is recorded
   */
  getStarter(messageId: string, emoji: string): Promise<string | null>;

  /**
   * Get multiple reaction starters for a message in a single query
   * Returns a Map of emoji -> starter userId for found starters
   * Performance optimization to avoid N+1 queries
   */
  getBatchStarters(
    messageId: string,
    emojis: string[],
  ): Promise<Map<string, string>>;

  /**
   * Get all reaction starters for a specific message
   * Returns a Map of emoji -> starter userId for all reactions on the message
   * Used for showing complete reaction history including removed reactions
   */
  getAllStartersForMessage(messageId: string): Promise<Map<string, string>>;

  /**
   * Delete old reaction starter records before the specified date
   * Used for cleanup to prevent unlimited growth
   * Returns the number of deleted records
   */
  deleteOldStarters(beforeDate: Date): Promise<number>;
}
