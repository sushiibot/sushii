import type { BotEmojiNameType } from "@/features/bot-emojis/domain";

export type HelpAudience = "members" | "moderators" | "admins";

export const HELP_AUDIENCES: readonly HelpAudience[] = [
  "members",
  "moderators",
  "admins",
];

export interface HelpCommandEntry {
  name: string;
  summary: string;
  /** Subcommand path to link; Discord won't render a mention of a command that has subcommands. */
  link?: string;
  /** ISO date; the command shows as new until this day starts (UTC). */
  newUntil?: string;
  keywords?: string[];
}

export interface HelpCategory {
  key: string;
  audience: HelpAudience;
  name: string;
  emoji: BotEmojiNameType;
  /** Most-used first. */
  commands: HelpCommandEntry[];
  /** Context menu command names, shown under Right-click → Apps. */
  apps?: string[];
}

const NEW_UNTIL = "2026-11-25";

export const HELP_CATEGORIES: readonly HelpCategory[] = [
  {
    key: "fun",
    audience: "members",
    name: "Fun & social",
    emoji: "fishies",
    commands: [
      { name: "fishy", summary: "Catch some fish!" },
      { name: "rep", summary: "Give someone reputation" },
      {
        name: "fishy-collection",
        summary: "Browse your fishy discoveries",
        newUntil: NEW_UNTIL,
      },
      { name: "fishy-leaderboard", summary: "Top fishers in this server" },
      { name: "rep-leaderboard", summary: "Top reputation in this server" },
    ],
  },
  {
    key: "levels",
    audience: "members",
    name: "Levels",
    emoji: "level_server",
    commands: [
      {
        name: "rank",
        summary: "Your or someone's rank",
        keywords: ["xp", "level"],
      },
      { name: "leaderboard", summary: "This server's leaderboard" },
      { name: "global-leaderboard", summary: "Total XP across all servers" },
      { name: "leaderboard-privacy", summary: "Appear as Anonymous globally" },
    ],
  },
  {
    key: "tags",
    audience: "members",
    name: "Tags",
    emoji: "note",
    commands: [
      { name: "t", summary: "Use a tag" },
      {
        name: "tag",
        link: "tag list",
        summary: "Browse, search and get info on tags",
      },
      { name: "tag-add", summary: "Create a tag" },
      { name: "tag-edit", summary: "Edit, rename or delete your tag" },
    ],
  },
  {
    key: "utils",
    audience: "members",
    name: "Utilities",
    emoji: "wrench",
    commands: [
      {
        name: "notification",
        link: "notification add",
        summary: "Get pinged when someone says a keyword",
        keywords: ["keyword", "highlight"],
      },
      {
        name: "reminder",
        link: "reminder add",
        summary: "Remind yourself later",
        keywords: ["remind"],
      },
      { name: "avatar", summary: "View someone's avatar" },
      { name: "schedule", summary: "Upcoming events in this server" },
      { name: "banner", summary: "View someone's banner" },
      { name: "userinfo", summary: "Info about a user" },
      { name: "emojistats", summary: "Server emoji usage" },
      { name: "status", summary: "sushii's status" },
    ],
    apps: ["User Info", "Submit to Mods"],
  },
  {
    key: "mod",
    audience: "moderators",
    name: "Moderation",
    emoji: "ban",
    commands: [
      { name: "ban", summary: "Ban members" },
      { name: "warn", summary: "Warn members" },
      { name: "timeout", summary: "Time out members", keywords: ["mute"] },
      { name: "kick", summary: "Kick members" },
      {
        name: "prune",
        summary: "Bulk delete messages",
        keywords: ["delete messages", "purge", "clear"],
      },
      { name: "slowmode", summary: "Set channel slowmode" },
      { name: "tempban", summary: "Ban for a set time" },
      { name: "softban", summary: "Ban and unban to clear messages" },
      { name: "unban", summary: "Unban users" },
      { name: "untimeout", summary: "Remove a timeout" },
      { name: "note", summary: "Add a note to a user's history" },
      {
        name: "reason-templates",
        summary: "Reason templates for autocomplete and !shortcut",
        keywords: ["templates", "shortcut", "saved reasons"],
      },
    ],
    apps: ["Mod View", "View Reaction Starters"],
  },
  {
    key: "cases",
    audience: "moderators",
    name: "Cases & lookup",
    emoji: "lookup",
    commands: [
      { name: "lookup", summary: "Cross-server bans for a user" },
      {
        name: "history",
        summary: "A user's case history",
        keywords: ["cases", "warnings"],
      },
      { name: "reason", summary: "Set the reason for cases" },
      { name: "modview", summary: "Full moderation view for a user" },
      { name: "uncase", summary: "Delete cases" },
      { name: "names", summary: "A user's name history" },
      { name: "alts", link: "alts view", summary: "Track alt accounts" },
      { name: "tempban-list", summary: "Active temporary bans" },
      { name: "verify-message", summary: "Look up a verified message" },
      {
        name: "verify-message-guide",
        summary: "How message verification works",
      },
    ],
  },
  {
    key: "setup",
    audience: "admins",
    name: "Server setup",
    emoji: "gear",
    commands: [
      {
        name: "settings",
        summary: "Logs, moderation DMs, automod, welcome messages",
        keywords: ["logs", "automod", "welcome"],
      },
      {
        name: "rolemenu",
        link: "rolemenu create",
        summary: "Self-assign role menus",
        keywords: ["self roles", "reaction roles"],
      },
      {
        name: "levelrole",
        link: "levelrole new",
        summary: "Roles given at levels",
        keywords: ["role rewards"],
      },
      {
        name: "xp",
        link: "xp block channel",
        summary: "Block XP in channels or for roles",
        keywords: ["no xp"],
      },
      { name: "giveaway", link: "giveaway create", summary: "Host giveaways" },
      {
        name: "schedule-config",
        link: "schedule-config new",
        summary: "Sync a Google Calendar to a channel",
        keywords: ["calendar", "events"],
      },
      {
        name: "tag-admin",
        link: "tag-admin delete",
        summary: "Manage server tags",
      },
      {
        name: "permission-audit",
        summary: "Find risky or unused role permissions",
        newUntil: NEW_UNTIL,
      },
    ],
  },
];

/** New line order; new commands missing here follow in catalog order. */
export const HELP_NEW_ORDER: readonly string[] = [
  "permission-audit",
  "fishy-collection",
];

/** Global commands /help never lists; the footer already points to /help. */
export const HELP_HIDDEN: ReadonlySet<string> = new Set(["help"]);

export const HELP_EMOJI_NAMES = [
  "sparkle",
  "fishies",
  "level_server",
  "note",
  "wrench",
  "ban",
  "lookup",
  "gear",
] as const satisfies readonly BotEmojiNameType[];
