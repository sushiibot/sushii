import { z } from "zod";

/**
 * Enum of all available bot emoji names.
 * Names must be lowercase with underscores only.
 * Add new emoji names here as you create the corresponding PNG files.
 */
export const BotEmojiName = z.enum([
  // Moderation Actions
  "ban",
  "unban",
  "note",
]);

export type BotEmojiName = z.infer<typeof BotEmojiName>;
