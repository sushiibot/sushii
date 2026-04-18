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
  "logs",
  "message_log",
  "bell",
  "lightning",
  "shield",
  "sound_off",
  "member_join",
  "member_leave",

  // Message Log
  "message_delete",
  "message_edit",

  // Schedule
  "schedule",
  "trash",

  // Numbers
  "num_0",
  "num_1",
  "num_2",
  "num_3",
  "num_4",
  "num_5",
  "num_6",
  "num_7",
  "num_8",
  "num_9",
]);

export type BotEmojiName = z.infer<typeof BotEmojiName>;
