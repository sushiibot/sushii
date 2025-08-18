import type { BotEmojiName } from "./BotEmojiName";

/**
 * Type-safe emoji mapping for views.
 * Provides readonly access to emoji strings keyed by emoji names.
 */
export type EmojiMap<T extends readonly BotEmojiName[]> = Readonly<
  Record<T[number], string>
>;
