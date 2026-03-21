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
  "tempban",
  "untimeout",
  "timeout",
  "kick",
  "warn",

  // Moderation Tools UI
  "attachment",
  "lookup",
  "reason",
  "tip",
  "dm_message",
  "additional_message",
  "history",
  "duration",

  // Rank Card
  "rep",
  "fishies",
  "level_server",
  "level_global",
  "rankings",

  // States
  "success",
  "fail",
  "disabled",
  "enabled",
  "warning",

  // UI
  "user",

  // Settings UI
  "save",
  "message_log",
  "bell",
  "lightning",
]);

export type BotEmojiName = z.infer<typeof BotEmojiName>;
