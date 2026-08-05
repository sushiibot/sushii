import type { BotEmojiNameType, EmojiMap } from "@/features/bot-emojis/domain";
import type { MessageLogBlock } from "@/features/message-log/domain/entities/MessageLogBlock";
import type {
  GuildConfig,
  ToggleableSetting,
} from "@/shared/domain/entities/GuildConfig";

import type { ChannelPermissionsMap } from "../../utils/PermissionChecker";

export type SettingsPage =
  | "overview"
  | "logging"
  | "moderation"
  | "lookup"
  | "mod-dms"
  | "automod"
  | "messages"
  | "more";

export const SETTINGS_EMOJI_NAMES = [
  "save",
  "logs",
  "history",
  "user",
  "message_log",
  "bell",
  "ban",
  "timeout",
  "kick",
  "dm_message",
  "warn",
  "lookup",
  "lightning",
  "shield",
  "sound_off",
  "member_join",
  "member_leave",
] as const satisfies readonly BotEmojiNameType[];

export interface SettingsMessageOptions {
  page: SettingsPage;
  config: GuildConfig;
  messageLogBlocks?: MessageLogBlock[];
  channelPermissions?: ChannelPermissionsMap;
  disabled?: boolean;
  emojis: EmojiMap<typeof SETTINGS_EMOJI_NAMES>;
}

export const SETTINGS_CUSTOM_IDS = {
  NAVIGATION: {
    TAB_OVERVIEW: "settings_tab_overview",
    TAB_LOGGING: "settings_tab_logging",
    TAB_MODERATION: "settings_tab_moderation",
    TAB_MOD_DMS: "settings_tab_mod_dms",
    TAB_LOOKUP: "settings_tab_lookup",
    TAB_MESSAGES: "settings_tab_messages",
    TAB_AUTOMOD: "settings_tab_automod",
    TAB_MORE: "settings_tab_more",
  },

  OVERVIEW: {
    VIEW_LOGGING: "settings_overview_view_logging",
    VIEW_MODERATION: "settings_overview_view_moderation",
    VIEW_MOD_DMS: "settings_overview_view_mod_dms",
    VIEW_LOOKUP: "settings_overview_view_lookup",
    VIEW_MESSAGES: "settings_overview_view_messages",
    VIEW_AUTOMOD: "settings_overview_view_automod",
  },

  TOGGLES: {
    // Log Toggles
    MOD_LOG: "settings_toggle_mod_log",
    MEMBER_LOG: "settings_toggle_member_log",
    MESSAGE_LOG: "settings_toggle_message_log",
    REACTION_LOG: "settings_toggle_reaction_log",

    // Message Toggles
    JOIN_MSG: "settings_toggle_join_msg",
    LEAVE_MSG: "settings_toggle_leave_msg",

    // Moderation Toggles
    LOOKUP_OPT_IN: "settings_toggle_lookup_opt_in",
    TIMEOUT_COMMAND_DM: "settings_toggle_timeout_command_dm",
    TIMEOUT_NATIVE_DM: "settings_toggle_timeout_native_dm",
    BAN_DM: "settings_toggle_ban_dm",
    KICK_DM: "settings_toggle_kick_dm",

    // Automod Toggles
    AUTOMOD_SPAM: "settings_toggle_automod_spam",
    AUTOMOD_SCAM_IMAGE: "settings_toggle_automod_scam_image",
  },

  ROLES: {
    SET_AUTOMOD_EXEMPT_ROLES: "settings_set_automod_exempt_roles",
  },

  CHANNELS: {
    // Log Channels
    SET_MOD_LOG: "settings_set_mod_log_channel",
    SET_MEMBER_LOG: "settings_set_member_log_channel",
    SET_MESSAGE_LOG: "settings_set_message_log_channel",
    SET_REACTION_LOG: "settings_set_reaction_log_channel",

    // Message Channels
    SET_JOIN_LEAVE: "settings_set_join_leave_channel",

    // Special Configuration
    MESSAGE_LOG_IGNORE: "settings_msglog_ignore_channels",

    // Automod Channels
    SET_AUTOMOD_ALERTS: "settings_set_automod_alerts_channel",
  },

  MODALS: {
    EDIT_JOIN_MESSAGE: "settings_edit_join_message",
    EDIT_LEAVE_MESSAGE: "settings_edit_leave_message",
    EDIT_TIMEOUT_DM_TEXT: "settings_edit_timeout_dm_text",
    EDIT_WARN_DM_TEXT: "settings_edit_warn_dm_text",
    EDIT_BAN_DM_TEXT: "settings_edit_ban_dm_text",
    EDIT_KICK_DM_TEXT: "settings_edit_kick_dm_text",
  },
} as const;

/** Which page each modal's edit lands back on after submission. */
export const MODAL_TARGET_PAGE_BY_CUSTOM_ID: ReadonlyMap<string, SettingsPage> =
  new Map([
    [SETTINGS_CUSTOM_IDS.MODALS.EDIT_JOIN_MESSAGE, "messages"],
    [SETTINGS_CUSTOM_IDS.MODALS.EDIT_LEAVE_MESSAGE, "messages"],
    [SETTINGS_CUSTOM_IDS.MODALS.EDIT_TIMEOUT_DM_TEXT, "mod-dms"],
    [SETTINGS_CUSTOM_IDS.MODALS.EDIT_WARN_DM_TEXT, "mod-dms"],
    [SETTINGS_CUSTOM_IDS.MODALS.EDIT_BAN_DM_TEXT, "mod-dms"],
    [SETTINGS_CUSTOM_IDS.MODALS.EDIT_KICK_DM_TEXT, "mod-dms"],
  ]);

/** Which setting each toggle button flips, and which page it re-renders. */
export const TOGGLE_SETTING_PAGE_BY_CUSTOM_ID: ReadonlyMap<
  string,
  { setting: ToggleableSetting; page: SettingsPage }
> = new Map([
  [SETTINGS_CUSTOM_IDS.TOGGLES.MOD_LOG, { setting: "modLog", page: "logging" }],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.MEMBER_LOG,
    { setting: "memberLog", page: "logging" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.MESSAGE_LOG,
    { setting: "messageLog", page: "logging" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.REACTION_LOG,
    { setting: "reactionLog", page: "logging" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.JOIN_MSG,
    { setting: "joinMessage", page: "messages" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.LEAVE_MSG,
    { setting: "leaveMessage", page: "messages" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.LOOKUP_OPT_IN,
    { setting: "lookupOptIn", page: "lookup" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.TIMEOUT_COMMAND_DM,
    { setting: "timeoutCommandDm", page: "moderation" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.TIMEOUT_NATIVE_DM,
    { setting: "timeoutNativeDm", page: "moderation" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.BAN_DM,
    { setting: "banDm", page: "moderation" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.KICK_DM,
    { setting: "kickDm", page: "moderation" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SPAM,
    { setting: "automodSpam", page: "automod" },
  ],
  [
    SETTINGS_CUSTOM_IDS.TOGGLES.AUTOMOD_SCAM_IMAGE,
    { setting: "automodScamImage", page: "automod" },
  ],
]);
