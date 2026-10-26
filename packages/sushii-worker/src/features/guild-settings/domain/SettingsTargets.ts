export const SETTINGS_TABS = [
  "overview",
  "logging",
  "moderation",
  "automod",
  "welcome",
] as const;

export const SETTINGS_EDIT_TARGETS = [
  "modlog",
  "memberlog",
  "msglog",
  "reactionlog",
  "dm-timeout",
  "dm-warn",
  "dm-ban",
  "dm-kick",
  "welcome-channel",
  "join",
  "leave",
  "exempt",
  "alerts",
  "screening",
] as const;

export const SETTINGS_TOGGLE_TARGETS = ["lookup", "scam", "spam"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type SettingsEditTarget = (typeof SETTINGS_EDIT_TARGETS)[number];
export type SettingsToggleTarget = (typeof SETTINGS_TOGGLE_TARGETS)[number];
