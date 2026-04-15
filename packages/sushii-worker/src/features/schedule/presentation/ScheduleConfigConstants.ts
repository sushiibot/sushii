import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";

import Color from "@/utils/colors";

export const SCHEDULE_CONFIG_SUBCOMMANDS = {
  NEW: "new",
  REMOVE: "remove",
  LIST: "list",
  REFRESH: "refresh",
} as const;

export const SCHEDULE_CONFIG_OPTIONS = {
  CHANNEL: "channel",
  SCHEDULE: "schedule",
} as const;

export const SCHEDULE_CONFIG_CUSTOM_IDS = {
  OPEN_MODAL_BUTTON: "schedule-config/open-modal",
  MODAL: "schedule-config/new",
  MODAL_FIELD_CALENDAR: "calendar",
  MODAL_FIELD_NAME: "name",
  MODAL_FIELD_CHANNEL: "channel",
  MODAL_FIELD_LOG_CHANNEL: "log-channel",
} as const;

export const SCHEDULE_CONFIG_EMOJI_NAMES = ["success", "fail", "warning", "schedule", "bell"] as const;
export const SCHEDULE_CONFIG_SETUP_EMOJI_NAMES = ["tip", "schedule"] as const;

export function makeContainer(
  message: string,
  color = Color.Error,
  ephemeral = false,
): { components: ContainerBuilder[]; flags: number } {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(message));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
  };
}
