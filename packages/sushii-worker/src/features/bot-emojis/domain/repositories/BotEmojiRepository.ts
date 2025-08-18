import type { BotEmojiName } from "../BotEmojiName";
import type { BotEmoji } from "../entities/BotEmoji";
import type { EmojiMap } from "../types";

/**
 * Repository interface for bot emoji operations.
 */
export interface BotEmojiRepository {
  /**
   * Gets multiple emojis by name and returns a type-safe emoji map.
   * Missing emojis will have empty string values.
   */
  getEmojis<T extends readonly BotEmojiName[]>(names: T): Promise<EmojiMap<T>>;

  /**
   * Gets a single emoji by name.
   * Returns null if not found.
   */
  getEmojiByName(name: BotEmojiName): Promise<BotEmoji | null>;

  /**
   * Gets all emojis from the database.
   */
  getAllEmojis(): Promise<BotEmoji[]>;

  /**
   * Saves a new emoji to the database.
   */
  saveEmoji(emoji: BotEmoji): Promise<void>;

  /**
   * Updates an existing emoji in the database.
   */
  updateEmoji(emoji: BotEmoji): Promise<void>;

  /**
   * Deletes an emoji from the database.
   */
  deleteEmoji(name: BotEmojiName): Promise<void>;

  /**
   * Checks if an emoji exists in the database.
   */
  exists(name: BotEmojiName): Promise<boolean>;
}
