import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
} from "discord.js";
import { Err, Ok } from "ts-results";
import type { Result } from "ts-results";

import Color from "@/utils/colors";

export const SCHEDULE_CONFIG_SUBCOMMANDS = {
  NEW: "new",
  EDIT: "edit",
  DELETE: "delete",
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
  // Delete confirmation buttons
  DELETE_CONFIRM_BUTTON: "schedule-config/delete/confirm",
  DELETE_CANCEL_BUTTON: "schedule-config/delete/cancel",
  DELETE_MATCH_PATTERN: "schedule-config/delete/:action{/:channelId}",
} as const;

/**
 * Custom ID values used as path-to-regexp match patterns.
 * Add any new match patterns here so they are covered by smoke tests.
 */
export const SCHEDULE_CONFIG_MATCH_PATTERNS = {
  OPEN_MODAL_BUTTON: SCHEDULE_CONFIG_CUSTOM_IDS.OPEN_MODAL_BUTTON,
  DELETE_MATCH_PATTERN: SCHEDULE_CONFIG_CUSTOM_IDS.DELETE_MATCH_PATTERN,
} as const;

export const SCHEDULE_CONFIG_EMOJI_NAMES = ["success", "fail", "warning", "schedule", "bell", "tip"] as const;
export const SCHEDULE_CONFIG_SETUP_EMOJI_NAMES = ["schedule", "num_1", "num_2", "num_3"] as const;

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

/**
 * Builds the setup instructions container shown by `/schedule-config new`.
 * Extracted so the button handler can re-include it alongside a permission error,
 * preserving the original message content when the user needs to retry.
 */
export function buildSetupInstructionsContainer(emojis: {
  schedule: string;
  num_1: string;
  num_2: string;
  num_3: string;
}): ContainerBuilder {
  return new ContainerBuilder()
    .setAccentColor(Color.Info)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          `## ${emojis.schedule} Setting Up a Schedule Channel`,
          "",
          "Your Google Calendar must be **public** before the bot can read it.",
          "Already have a calendar you'd like to use? Skip to Step 2.",
          "",
          `${emojis.num_1} **Create a new calendar**`,
          "Open [Google Calendar Settings](https://calendar.google.com/calendar/r/settings) and click",
          "**+ Add other → Create new calendar**. Give it a name like *Server Events*.",
          "We recommend a dedicated calendar so personal events stay private.",
          "",
          `${emojis.num_2} **Make the calendar public**`,
          "Select your calendar in Settings. Under **Access permissions for events**:",
          "- Check **Make available to public**",
          '- Set to **See all event details**',
          "",
          `${emojis.num_3} **Copy the Calendar ID**`,
          "Scroll to **Integrate calendar** and copy the **Calendar ID**",
          "(e.g. `abc123@group.calendar.google.com`). You can also copy the **Public URL to this calendar**.",
          "",
          "-# When ready, click the button below to continue.",
        ].join("\n"),
      ),
    )
    .addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(SCHEDULE_CONFIG_CUSTOM_IDS.OPEN_MODAL_BUTTON)
          .setLabel("Set Up Schedule Channel")
          .setStyle(ButtonStyle.Primary),
      ),
    );
}

/**
 * Builds the "Managing your schedule" tips section shown after a successful setup.
 */
export function buildPostSetupGuide(emojis: { tip: string }, intervalDisplay: string): string {
  return [
    "## Managing your schedule",
    "",
    `${emojis.tip} **Adding & editing events**`,
    `Add or update events directly in Google Calendar — changes sync automatically ${intervalDisplay}. You can also ask [Gemini](https://gemini.google.com) to add events for you. Use \`/schedule-config refresh\` to force an immediate sync.`,
    "",
    `${emojis.tip} **Timezones**`,
    "Create events in any timezone — members always see times in their own local timezone.",
    "",
    `${emojis.tip} **Clickable links**`,
    "Set an event's **Location** to a URL (e.g. a stream or ticket link) and it becomes a clickable link in the schedule.",
    "",
    `${emojis.tip} **Emoji categories**`,
    "Start an event name with an emoji — e.g. `🎵 Concert Night` — and it appears before the date for easy visual grouping.",
  ].join("\n");
}
