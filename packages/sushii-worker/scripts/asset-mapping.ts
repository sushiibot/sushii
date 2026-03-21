import type { BotEmojiNameType } from "../src/features/bot-emojis/domain";

/**
 * Maps licensed asset source paths (relative to ASSETS_ROOT) to bot emoji names.
 * Run scripts/encrypt-assets.ts to encrypt these into assets-encrypted/*.png.age
 */
export const ASSET_MAPPING: { src: string; name: BotEmojiNameType }[] = [
  // Moderation Actions
  { src: "Weapons/Banhammer/Banhammer Outline 256.png", name: "ban" },
  { src: "General/Lock/Unlock Outline 256.png", name: "unban" },
  { src: "Tools/Hourglass/Hourglass Outline 256.png", name: "tempban" },
  { src: "Player/Leg/Leg Outline 256.png", name: "kick" },
  { src: "Tools/Frozen Clock/Frozen Clock Outline 256.png", name: "timeout" },
  { src: "UI/Undo/Undo Outline 256.png", name: "untimeout" },
  { src: "UI/Warning/Warning Outline 256.png", name: "warn" },
  { src: "Items/Sticky Note/Sticky Note Yellow Outline 256.png", name: "note" },

  // Moderation Tools UI
  { src: "UI/Upload/Upload Outline.png", name: "attachment" },
  {
    src: "Tools/Magnifying Glass/Magnifying Glass Outline 256.png",
    name: "lookup",
  },
  { src: "Items/Scroll/Scroll Outline 256.png", name: "reason" },
  { src: "Technology/Lightbulb/Lightbulb Outline 256.png", name: "tip" },
  { src: "UI/Message Box/Message Box Outline 256.png", name: "dm_message" },
  {
    src: "Items/Envelope/Envelope Outline 256.png",
    name: "additional_message",
  },
  { src: "UI/Calendar/Calendar Outline 256.png", name: "history" },
  { src: "Tools/Clock/Clock Outline 256.png", name: "duration" },

  // States
  { src: "UI/Check Mark/Check Mark Outline 256.png", name: "success" },
  { src: "UI/X/X Outline 256.png", name: "fail" },
  { src: "UI/Warning/Warning Outline 256.png", name: "warning" },
  { src: "UI/Check Mark/Check Mark Outline 256.png", name: "enabled" }, // TODO: find distinct icon
  { src: "UI/X Button/X Button Outline 256.png", name: "disabled" },

  // Rank Card
  { src: "General/Star/Star Outline 256.png", name: "rep" },
  { src: "Items/Fish/Fish Outline 256.png", name: "fishies" },
  { src: "General/Trophy/Trophy Outline 256.png", name: "rankings" },
  { src: "General/Stats/Stats Outline 256.png", name: "level_server" },
  { src: "Nature/Globe/Globe Outline 256.png", name: "level_global" },

  // UI
  { src: "Player/Head/Head Outline 256.png", name: "user" },

  // Settings UI
  { src: "UI/Save/Save Outline 256.png", name: "save" },
  { src: "Tools/Pencil/Pencil Outline 256.png", name: "message_log" },
  { src: "UI/Bell/Bell Outline 256.png", name: "bell" },
  { src: "General/Lightning Bolt/Lightning Bolt Outline 256.png", name: "lightning" },
];
