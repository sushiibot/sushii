import type { SlashCommandBuilder } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

import type { ModerationCommandConfig } from "@/features/moderation/actions/presentation/commands/ModerationCommand";

import { ActionType } from "../../domain/value-objects/ActionType";
import {
  addAttachmentOption,
  addDaysToDeleteOption,
  addDmReasonOption,
  addDurationOption,
  addNoteOption,
  addReasonOption,
  addUsersOption,
} from "./ModerationCommandOptions";

export const OPTION_NAMES = {
  USERS: "users",
  REASON: "reason",
  ATTACHMENT: "attachment",
  DM_REASON: "dm_reason",
  DAYS_TO_DELETE: "days_to_delete",
  DURATION: "duration",
  CHANNEL: "channel",
  NOTE: "note",
} as const;

export const COMMAND_METADATA = {
  BAN: {
    name: "ban",
    description: "Ban users from the server",
  },
  WARN: {
    name: "warn",
    description: "Warn members for rule violations",
  },
  TEMPBAN: {
    name: "tempban",
    description: "Temporarily ban users",
  },
  KICK: {
    name: "kick",
    description: "Kick users from the server",
  },
  TIMEOUT: {
    name: "timeout",
    description: "Timeout users",
  },
  UNBAN: {
    name: "unban",
    description: "Unban users",
  },
  UNTIMEOUT: {
    name: "untimeout",
    description: "Remove timeout from users",
  },
  NOTE: {
    name: "note",
    description: "Add a private note to users, only visible to staff",
  },
} as const;

export const COMMAND_CONFIGS: Record<string, ModerationCommandConfig> = {
  BAN: {
    actionType: ActionType.Ban,
    name: COMMAND_METADATA.BAN.name,
    description: COMMAND_METADATA.BAN.description,
    permissions: PermissionFlagsBits.BanMembers,
    options: (builder: SlashCommandBuilder) =>
      builder
        .addStringOption(addUsersOption)
        .addStringOption(addReasonOption)
        .addIntegerOption(addDaysToDeleteOption)
        .addAttachmentOption(addAttachmentOption)
        .addStringOption(addDmReasonOption),
  },
  WARN: {
    actionType: ActionType.Warn,
    name: COMMAND_METADATA.WARN.name,
    description: COMMAND_METADATA.WARN.description,
    permissions: PermissionFlagsBits.BanMembers,
    requiresReason: true,
    options: (builder: SlashCommandBuilder) =>
      builder
        .addStringOption(addUsersOption)
        // Required for warn commands
        .addStringOption((o) => addReasonOption(o, true))
        // No DM option for warn command, as doesn't make sense to not DM warning
        .addAttachmentOption(addAttachmentOption),
  },
  TEMPBAN: {
    actionType: ActionType.TempBan,
    name: COMMAND_METADATA.TEMPBAN.name,
    description: COMMAND_METADATA.TEMPBAN.description,
    permissions: PermissionFlagsBits.BanMembers,
    options: (builder: SlashCommandBuilder) =>
      builder
        .addStringOption(addUsersOption)
        .addStringOption(addDurationOption)
        .addStringOption(addReasonOption)
        .addAttachmentOption(addAttachmentOption)
        .addStringOption(addDmReasonOption),
  },
  KICK: {
    actionType: ActionType.Kick,
    name: COMMAND_METADATA.KICK.name,
    description: COMMAND_METADATA.KICK.description,
    permissions: PermissionFlagsBits.KickMembers,
    options: (builder: SlashCommandBuilder) =>
      builder
        .addStringOption(addUsersOption)
        .addStringOption(addReasonOption)
        .addAttachmentOption(addAttachmentOption)
        .addStringOption(addDmReasonOption),
  },
  TIMEOUT: {
    actionType: ActionType.Timeout,
    name: COMMAND_METADATA.TIMEOUT.name,
    description: COMMAND_METADATA.TIMEOUT.description,
    permissions: PermissionFlagsBits.ModerateMembers,
    options: (builder: SlashCommandBuilder) =>
      builder
        .addStringOption(addUsersOption)
        .addStringOption(addDurationOption)
        .addStringOption(addReasonOption)
        .addAttachmentOption(addAttachmentOption)
        .addStringOption(addDmReasonOption),
  },
  UNBAN: {
    actionType: ActionType.BanRemove,
    name: COMMAND_METADATA.UNBAN.name,
    description: COMMAND_METADATA.UNBAN.description,
    permissions: PermissionFlagsBits.BanMembers,
    options: (builder: SlashCommandBuilder) =>
      builder.addStringOption(addUsersOption).addStringOption(addReasonOption),
  },
  UNTIMEOUT: {
    actionType: ActionType.TimeoutRemove,
    name: COMMAND_METADATA.UNTIMEOUT.name,
    description: COMMAND_METADATA.UNTIMEOUT.description,
    permissions: PermissionFlagsBits.ModerateMembers,
    options: (builder: SlashCommandBuilder) =>
      builder
        .addStringOption(addUsersOption)
        .addStringOption(addReasonOption)
        .addStringOption(addDmReasonOption),
  },
  NOTE: {
    actionType: ActionType.Note,
    name: COMMAND_METADATA.NOTE.name,
    description: COMMAND_METADATA.NOTE.description,
    permissions: PermissionFlagsBits.BanMembers,
    options: (builder: SlashCommandBuilder) =>
      builder
        .addStringOption(addUsersOption)
        .addStringOption(addNoteOption)
        .addAttachmentOption(addAttachmentOption),
  },
};
