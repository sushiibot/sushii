import type { ReactionStarter } from "../entities/ReactionStarter";

export interface ReactionStarterRepository {
  /**
   * Save who started a reaction for a specific emoji on a message
   * Uses onConflictDoNothing to handle race conditions and duplicate users
   */
  saveStarter(
    messageId: string,
    emojiId: string,
    emojiName: string | null,
    userId: string,
    guildId: string,
  ): Promise<void>;

  /**
   * Check if any starter exists for a specific emoji on a message
   * Returns true if any user has started this reaction
   */
  hasAnyStarter(messageId: string, emojiId: string): Promise<boolean>;

  /**
   * Get all users who started a reaction for a specific emoji on a message
   * Returns array of user IDs ordered by created_at (first starter first)
   * Returns empty array if no starters are recorded
   */
  getStarters(messageId: string, emojiId: string): Promise<string[]>;

  /**
   * Get multiple reaction starters for a message in a single query
   * Returns a Map of emojiId -> array of starter userIds for found starters
   * Performance optimization to avoid N+1 queries
   */
  getBatchAllStarters(
    messageId: string,
    emojiIds: string[],
  ): Promise<Map<string, string[]>>;

  /**
   * Get all reaction starters for a specific message
   * Returns a Map of emojiId -> ReactionStarter for all reactions on the message
   * Used for showing complete reaction history including removed reactions
   */
  getAllStartersForMessage(
    messageId: string,
  ): Promise<Map<string, ReactionStarter>>;

  /**
   * Delete old reaction starter records before the specified date
   * Used for cleanup to prevent unlimited growth
   * Returns the number of deleted records
   */
  deleteOldStarters(beforeDate: Date): Promise<number>;
}
