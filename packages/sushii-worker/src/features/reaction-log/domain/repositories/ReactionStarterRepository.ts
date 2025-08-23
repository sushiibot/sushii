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
   * Delete old reaction starter records before the specified date
   * Used for cleanup to prevent unlimited growth
   * Returns the number of deleted records
   */
  deleteOldStarters(beforeDate: Date): Promise<number>;
}
