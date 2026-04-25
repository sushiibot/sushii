import type {
  SlashCommandAttachmentOption,
  SlashCommandIntegerOption,
  SlashCommandStringOption,
} from "discord.js";

import { OPTION_NAMES } from "./ModerationCommandConstants";

export function addUsersOption(option: SlashCommandStringOption) {
  return option
    .setName(OPTION_NAMES.USERS)
    .setDescription(
      "Which users to target. This can be multiple users with IDs or mentions.",
    )
    .setRequired(true);
}

export function addReasonOption(
  option: SlashCommandStringOption,
  required: boolean = false,
) {
  return option
    .setName(OPTION_NAMES.REASON)
    .setDescription("Reason for this action.")
    .setRequired(required);
}

export function addAttachmentOption(option: SlashCommandAttachmentOption) {
  return option
    .setName(OPTION_NAMES.ATTACHMENT)
    .setDescription("Mod-only attachment.")
    .setRequired(false);
}

export function addDmReasonOption(option: SlashCommandStringOption) {
  return option
    .setName(OPTION_NAMES.DM_REASON)
    .setDescription("Do you want to DM the user the reason?")
    .setChoices(
      { name: "Yes: DM the user the reason", value: "yes_dm" },
      { name: "No: Do not DM the user the reason", value: "no_dm" },
    )
    .setRequired(false);
}

export function addDaysToDeleteOption(option: SlashCommandIntegerOption) {
  return option
    .setName(OPTION_NAMES.DAYS_TO_DELETE)
    .setDescription("Number of days to delete messages for")
    .setMaxValue(7)
    .setMinValue(0)
    .setRequired(false);
}

export function addSoftbanDeleteOption(option: SlashCommandIntegerOption) {
  return option
    .setName(OPTION_NAMES.DELETE_MESSAGES)
    .setDescription("How far back to delete messages")
    .setRequired(true)
    .setChoices(
      { name: "1 hour", value: 3600 },
      { name: "6 hours", value: 21600 },
      { name: "1 day", value: 86400 },
      { name: "3 days", value: 259200 },
      { name: "7 days", value: 604800 },
    );
}

export function addDurationOption(option: SlashCommandStringOption) {
  return option
    .setName(OPTION_NAMES.DURATION)
    .setDescription("Duration (e.g., 1h, 30m, 1d)")
    .setRequired(true);
}

export function addNoteOption(
  option: SlashCommandStringOption,
  required: boolean = true,
) {
  return option
    .setName("note")
    .setDescription("Mod-only note to add to the user.")
    .setRequired(required);
}
