import type { BotEmojiName } from "../src/features/bot-emojis/domain/BotEmojiName";

export interface EmojiEntry {
  /** Must match a value in the BotEmojiName enum */
  name: BotEmojiName;
  /** Lucide icon name (e.g. "heart", "fish") — must exist in lucide-static/icons/ */
  icon: string;
  /** Hex color for the icon stroke (replacing currentColor) */
  color: string;
}

// Catppuccin Mocha palette reference:
// Red: #f38ba8 | Teal: #94e2d5 | Yellow: #f9e2af | Blue: #89b4fa | Green: #a6e3a1
// Peach: #fab387 | Mauve: #cba6f7 | Pink: #f5c2e7 | Sapphire: #74c7ec | Lavender: #b4befe

export const emojiConfig: EmojiEntry[] = [
  { name: "rep", icon: "heart", color: "#f38ba8" }, // Mocha Red
  { name: "fishies", icon: "fish-symbol", color: "#94e2d5" }, // Mocha Teal
  { name: "level_server", icon: "star", color: "#f9e2af" }, // Mocha Yellow
  { name: "level_global", icon: "globe", color: "#89b4fa" }, // Mocha Blue
  { name: "rankings", icon: "trophy", color: "#f9e2af" }, // Mocha Yellow
];
