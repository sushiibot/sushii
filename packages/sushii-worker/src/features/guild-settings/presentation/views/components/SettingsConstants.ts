import type { MessageLogBlock } from "@/features/message-log/domain/entities/MessageLogBlock";
import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { ChannelPermissionsMap } from "../../utils/PermissionChecker";

export type SettingsPage = "logging" | "moderation" | "messages" | "advanced";

export interface SettingsMessageOptions {
  page: SettingsPage;
  config: GuildConfig;
  messageLogBlocks?: MessageLogBlock[];
  channelPermissions?: ChannelPermissionsMap;
  disabled?: boolean;
}

export const SETTINGS_CUSTOM_IDS = {
  NAVIGATION: {
    BASE: "settings_nav",
    LOGGING: "settings_nav_logging",
    MODERATION: "settings_nav_moderation",
    MESSAGES: "settings_nav_messages",
    ADVANCED: "settings_nav_advanced",
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
  },

  MODALS: {
    EDIT_JOIN_MESSAGE: "settings_edit_join_message",
    EDIT_LEAVE_MESSAGE: "settings_edit_leave_message",
    EDIT_TIMEOUT_DM_TEXT: "settings_edit_timeout_dm_text",
    EDIT_WARN_DM_TEXT: "settings_edit_warn_dm_text",
    EDIT_BAN_DM_TEXT: "settings_edit_ban_dm_text",
  },
} as const;
