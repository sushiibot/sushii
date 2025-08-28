// Sunset date for legacy commands - update this as needed
export const LEGACY_COMMAND_SUNSET_DATE = new Date("2025-09-20");

export interface LegacyCommandMapping {
  primary: string;
  aliases: string[];
  replacement: string;
}

export const LEGACY_COMMANDS: LegacyCommandMapping[] = [
  { primary: "rep", aliases: [], replacement: "/rep" },
  { primary: "fishy", aliases: [], replacement: "/fishy" },
  {
    primary: "rank",
    aliases: ["profile", "rakn", "rnak", "arnk"],
    replacement: "/rank",
  },
  { primary: "avatar", aliases: [], replacement: "/avatar" },
  { primary: "banner", aliases: [], replacement: "/banner" },
  { primary: "tag", aliases: ["t"], replacement: "/t" }, // Base command for get
];

export const TAG_SUBCOMMAND_MAPPINGS: Record<string, string> = {
  add: "/tag-add",
  edit: "/tag-edit",
  rename: "/tag-edit",
  delete: "/tag-edit",
  info: "/tag info",
  list: "/tag list",
  search: "/tag search",
  random: "/tag random",
  // default/get handled by base tag command
};

// How long to wait for bot response after detecting potential command
export const BOT_RESPONSE_TIMEOUT_MS = 3000;

// Known tag subcommands for metrics cardinality control
export const KNOWN_TAG_SUBCOMMANDS = [
  "tag add",
  "tag edit",
  "tag info",
  "tag list",
  "tag search",
  "tag random",
];

// Memory safety settings
export const MAX_PENDING_COMMANDS = 1000;
export const PENDING_COMMANDS_CLEANUP_INTERVAL_MS = 60000; // 1 minute
