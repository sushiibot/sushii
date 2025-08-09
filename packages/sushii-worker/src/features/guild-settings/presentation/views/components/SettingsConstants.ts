import type { MessageLogBlock } from "@/features/guild-settings/domain/entities/MessageLogBlock";
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
  NAVIGATION: "settings_nav",
  NAVIGATION_LOGGING: "settings_nav_logging",
  NAVIGATION_MODERATION: "settings_nav_moderation",
  NAVIGATION_MESSAGES: "settings_nav_messages",
  NAVIGATION_ADVANCED: "settings_nav_advanced",
  TOGGLE_MOD_LOG: "settings_toggle_mod_log",
  TOGGLE_MEMBER_LOG: "settings_toggle_member_log",
  TOGGLE_MESSAGE_LOG: "settings_toggle_message_log",
  TOGGLE_JOIN_MSG: "settings_toggle_join_msg",
  TOGGLE_LEAVE_MSG: "settings_toggle_leave_msg",
  TOGGLE_LOOKUP_OPT_IN: "settings_toggle_lookup_opt_in",
  TOGGLE_TIMEOUT_COMMAND_DM: "settings_toggle_timeout_command_dm",
  TOGGLE_TIMEOUT_NATIVE_DM: "settings_toggle_timeout_native_dm",
  TOGGLE_BAN_DM: "settings_toggle_ban_dm",
  SET_MOD_LOG_CHANNEL: "settings_set_mod_log_channel",
  SET_MEMBER_LOG_CHANNEL: "settings_set_member_log_channel",
  SET_MESSAGE_LOG_CHANNEL: "settings_set_message_log_channel",
  SET_JOIN_LEAVE_CHANNEL: "settings_set_join_leave_channel",
  EDIT_JOIN_MESSAGE: "settings_edit_join_message",
  EDIT_LEAVE_MESSAGE: "settings_edit_leave_message",
  EDIT_TIMEOUT_DM_TEXT: "settings_edit_timeout_dm_text",
  EDIT_WARN_DM_TEXT: "settings_edit_warn_dm_text",
  EDIT_BAN_DM_TEXT: "settings_edit_ban_dm_text",
  MESSAGE_LOG_IGNORE_CHANNELS: "settings_msglog_ignore_channels",
} as const;
