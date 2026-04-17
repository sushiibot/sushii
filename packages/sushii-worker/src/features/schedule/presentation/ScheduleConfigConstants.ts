import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import { Err, Ok } from "ts-results";
import type { Result } from "ts-results";

import Color from "@/utils/colors";

export const SCHEDULE_CONFIG_SUBCOMMANDS = {
  NEW: "new",
  EDIT: "edit",
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
  MODAL_FIELD_COLOR: "color",
  // Edit modal
  MODAL_EDIT: "schedule-config/edit",
  MODAL_EDIT_FIELD_NAME: "edit-name",
  MODAL_EDIT_FIELD_CHANNEL: "edit-channel",
  MODAL_EDIT_FIELD_LOG_CHANNEL: "edit-log-channel",
  MODAL_EDIT_FIELD_COLOR: "edit-color",
} as const;

export const SCHEDULE_CONFIG_EMOJI_NAMES = ["success", "fail", "warning", "schedule", "bell"] as const;
export const SCHEDULE_CONFIG_SETUP_EMOJI_NAMES = ["tip", "schedule"] as const;

/** Timeout (ms) for awaiting modal submission — 5 minutes. */
export const MODAL_AWAIT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Parses a hex color string (with or without leading `#`) into a 24-bit integer.
 * Returns null for blank input, Err for invalid input.
 */
export function parseHexColor(input: string): Result<number | null, string> {
  const trimmed = input.trim().replace(/^#/, "");
  if (!trimmed) return Ok(null);
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return Err("Invalid hex color — use a 6-digit code like `#ff6b6b` or `ff6b6b`");
  }
  return Ok(parseInt(trimmed, 16));
}

/** Formats a 24-bit integer color as a `#rrggbb` hex string. */
export function formatHexColor(color: number): string {
  return "#" + color.toString(16).padStart(6, "0");
}

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
