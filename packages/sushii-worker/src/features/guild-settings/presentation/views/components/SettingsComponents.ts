import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { MODERATION_DM_CUSTOM_EXAMPLES } from "@/features/guild-settings/domain/constants/ModerationDefaults";

import { SETTINGS_CUSTOM_IDS, SettingsPage } from "./SettingsConstants";

export function createFooter(disabled = false): TextDisplayBuilder {
  let footerContent: string;

  if (disabled) {
    footerContent =
      "-# Inputs expired after 2 minutes of inactivity, re-run command to make changes.";
  } else {
    footerContent =
      "-# Inputs expire in 2 minutes of inactivity. Changes are saved automatically.";
  }

  return new TextDisplayBuilder().setContent(footerContent);
}

export function createNavigationRow(
  currentPage: SettingsPage,
  disabled = false,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.NAVIGATION_LOGGING)
      .setLabel("Logging")
      .setStyle(
        currentPage === "logging" ? ButtonStyle.Primary : ButtonStyle.Secondary,
      )
      .setDisabled(currentPage === "logging" || disabled),
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.NAVIGATION_MODERATION)
      .setLabel("Moderation")
      .setStyle(
        currentPage === "moderation"
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      )
      .setDisabled(currentPage === "moderation" || disabled),
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.NAVIGATION_MESSAGES)
      .setLabel("Messages")
      .setStyle(
        currentPage === "messages"
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      )
      .setDisabled(currentPage === "messages" || disabled),
    new ButtonBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.NAVIGATION_ADVANCED)
      .setLabel("Advanced")
      .setStyle(
        currentPage === "advanced"
          ? ButtonStyle.Primary
          : ButtonStyle.Secondary,
      )
      .setDisabled(currentPage === "advanced" || disabled),
  );
}

export function formatLogSetting(
  name: string,
  channelId: string | null,
  enabled: boolean,
  description: string,
): string {
  const status = enabled ? "`✅ Enabled`" : "`❌ Disabled`";
  const channel = channelId ? `<#${channelId}>` : "No channel set";

  let text = `**${name}** — ${status} (${channel})\n`;
  text += `> ${description}\n`;

  return text;
}

export function formatToggleMessageSetting(
  name: string,
  message: string | null,
  enabled: boolean,
  description: string,
  defaultMessage?: string,
): string {
  let s = `**${name}** — `;
  s += enabled ? "`✅ Enabled`" : "`❌ Disabled`";
  s += `\n> ${description}`;

  s += `\n\`\`\``;
  if (message) {
    s += `\n${message}`;
  } else if (defaultMessage) {
    s += `\nDefault: ${defaultMessage}`;
  } else {
    s += `\nNo message set`;
  }
  s += `\n\`\`\`\n`;

  return s;
}

export function formatMessageSetting(
  name: string,
  message: string | null,
  description: string,
  defaultMessage?: string,
): string {
  let s = `**${name}**`;
  s += `\n> ${description}`;

  s += `\n\`\`\``;
  if (message) {
    s += `\n${message}`;
  } else if (defaultMessage) {
    s += `\nDefault: ${defaultMessage}`;
  } else {
    s += `\nNo message set`;
  }
  s += `\n\`\`\`\n`;

  return s;
}

export function formatToggleSetting(
  name: string,
  enabled: boolean,
  description: string,
): string {
  let s = `**${name}** — `;
  s += enabled ? "`✅ Enabled`" : "`❌ Disabled`";
  s += `\n> ${description}`;

  return s;
}

export function createToggleButton(
  currentlyEnabled: boolean,
  customId: string,
  disabled = false,
): ButtonBuilder {
  const action = currentlyEnabled ? "Disable" : "Enable";

  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(`${action}`)
    .setStyle(currentlyEnabled ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(disabled);
}

export function createJoinMessageModal(
  currentMessage: string | null,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_JOIN_MESSAGE)
    .setTitle("Edit Join Message");

  const messageInput = new TextInputBuilder()
    .setCustomId("join_message_input")
    .setLabel("Join Message")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentMessage || "")
    .setPlaceholder(
      "Welcome <username> to <server>! You are member #<member_number>",
    )
    .setRequired(false)
    .setMaxLength(1000);

  if (currentMessage) {
    messageInput.setValue(currentMessage);
  }

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    messageInput,
  );
  modal.addComponents(actionRow);

  return modal;
}

export function createLeaveMessageModal(
  currentMessage: string | null,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_LEAVE_MESSAGE)
    .setTitle("Edit Leave Message");

  const messageInput = new TextInputBuilder()
    .setCustomId("leave_message_input")
    .setLabel("Leave Message")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentMessage || "")
    .setPlaceholder("<username> has left <server>")
    .setRequired(false)
    .setMaxLength(1000);

  if (currentMessage) {
    messageInput.setValue(currentMessage);
  }

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    messageInput,
  );
  modal.addComponents(actionRow);

  return modal;
}

export function createTimeoutDmTextModal(
  currentText: string | null,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_TIMEOUT_DM_TEXT)
    .setTitle("Edit Timeout DM Text");

  const textInput = new TextInputBuilder()
    .setCustomId("timeout_dm_text_input")
    .setLabel("Timeout DM Text")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentText || "")
    .setPlaceholder(MODERATION_DM_CUSTOM_EXAMPLES.TIMEOUT_DM_TEXT)
    .setRequired(false)
    .setMaxLength(1000);

  if (currentText) {
    textInput.setValue(currentText);
  }

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    textInput,
  );
  modal.addComponents(actionRow);

  return modal;
}

export function createWarnDmTextModal(
  currentText: string | null,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_WARN_DM_TEXT)
    .setTitle("Edit Warn DM Text");

  const textInput = new TextInputBuilder()
    .setCustomId("warn_dm_text_input")
    .setLabel("Warn DM Text")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentText || "")
    .setPlaceholder(MODERATION_DM_CUSTOM_EXAMPLES.WARN_DM_TEXT)
    .setRequired(false)
    .setMaxLength(1000);

  if (currentText) {
    textInput.setValue(currentText);
  }

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    textInput,
  );
  modal.addComponents(actionRow);

  return modal;
}

export function createBanDmTextModal(currentText: string | null): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.EDIT_BAN_DM_TEXT)
    .setTitle("Edit Ban DM Text");

  const textInput = new TextInputBuilder()
    .setCustomId("ban_dm_text_input")
    .setLabel("Ban DM Text")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentText || "")
    .setPlaceholder(MODERATION_DM_CUSTOM_EXAMPLES.BAN_DM_TEXT)
    .setRequired(false)
    .setMaxLength(1000);

  if (currentText) {
    textInput.setValue(currentText);
  }

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    textInput,
  );
  modal.addComponents(actionRow);

  return modal;
}
