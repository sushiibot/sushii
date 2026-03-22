import type { ContainerBuilder } from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { MODERATION_DM_CUSTOM_EXAMPLES } from "@/features/guild-settings/domain/constants/ModerationDefaults";

import type { EmojiMap } from "@/features/bot-emojis/domain";

import type { SETTINGS_EMOJI_NAMES, SettingsPage } from "./SettingsConstants";
import { SETTINGS_CUSTOM_IDS } from "./SettingsConstants";

export function parseEmojiForSelect(
  emojiString: string,
): { name: string; id: string } | undefined {
  const match = emojiString.match(/^<a?:(\w+):(\d+)>$/);
  if (!match) return undefined;
  return { name: match[1], id: match[2] };
}

export function createFooter(disabled = false): TextDisplayBuilder {
  let footerContent: string;

  if (disabled) {
    footerContent =
      "-# Inputs expired after 5 minutes of inactivity, re-run command to make changes.";
  } else {
    footerContent =
      "-# Inputs expire in 5 minutes of inactivity. Changes are saved automatically.";
  }

  return new TextDisplayBuilder().setContent(footerContent);
}


export function createNavigationDropdown(
  currentPage: SettingsPage,
  disabled = false,
  emojis: EmojiMap<typeof SETTINGS_EMOJI_NAMES>,
): ActionRowBuilder<StringSelectMenuBuilder> {
  // IMPORTANT: Each nav option's emoji must match the `## emoji PageName` header
  // in its corresponding *PageBuilder.ts file. Keep these in sync when changing
  // page header emojis.
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SETTINGS_CUSTOM_IDS.NAVIGATION.SELECT)
      .setPlaceholder("Go to settings page...")
      .setDisabled(disabled)
      .addOptions(
        {
          label: "Logging",
          description: "Log channels and toggles",
          value: "logging",
          default: currentPage === "logging",
          emoji: parseEmojiForSelect(emojis.logs), // matches LoggingPageBuilder `## logs Logging`
        },
        {
          label: "Moderation",
          description: "DM settings for moderation actions",
          value: "moderation",
          default: currentPage === "moderation",
          emoji: parseEmojiForSelect(emojis.ban),
        },
        {
          label: "Moderation DMs",
          description: "DM message templates",
          value: "mod-dms",
          default: currentPage === "mod-dms",
          emoji: parseEmojiForSelect(emojis.dm_message),
        },
        {
          label: "Lookup",
          description: "Lookup data sharing",
          value: "lookup",
          default: currentPage === "lookup",
          emoji: parseEmojiForSelect(emojis.lookup),
        },
        {
          label: "Welcome Messages",
          description: "Join/leave messages",
          value: "messages",
          default: currentPage === "messages",
          emoji: parseEmojiForSelect(emojis.dm_message),
        },
        {
          label: "Automod",
          description: "Automated moderation",
          value: "automod",
          default: currentPage === "automod",
          emoji: parseEmojiForSelect(emojis.shield),
        },
      ),
  );
}

export function createToggleButton(
  currentlyEnabled: boolean,
  customId: string,
  disabled = false,
): ButtonBuilder {
  const action = currentlyEnabled ? "Disable" : "Enable";

  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(action)
    .setStyle(currentlyEnabled ? ButtonStyle.Secondary : ButtonStyle.Success)
    .setDisabled(disabled);
}

export function addToggleSetting(
  container: ContainerBuilder,
  name: string,
  description: string,
  enabled: boolean,
  customId: string,
  disabled = false,
): void {
  const content = `**${name}**\n${description}`;

  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
      .setButtonAccessory(createToggleButton(enabled, customId, disabled)),
  );
}

export function createEditSection(
  name: string,
  description: string,
  editCustomId: string,
  disabled = false,
): SectionBuilder {
  const content = `**${name}**\n${description}`;

  return new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(content))
    .setButtonAccessory(
      new ButtonBuilder()
        .setCustomId(editCustomId)
        .setLabel("Edit")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled),
    );
}

export function createJoinMessageModal(
  currentMessage: string | null,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_JOIN_MESSAGE)
    .setTitle("Edit Join Message");

  const messageInput = new TextInputBuilder()
    .setCustomId("join_message_input")
    .setLabel("Join Message")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentMessage || "")
    .setPlaceholder(
      "Welcome <mention> to <server>! You are member #<member_number>",
    )
    .setRequired(false)
    .setMaxLength(1000);

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
    .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_LEAVE_MESSAGE)
    .setTitle("Edit Leave Message");

  const messageInput = new TextInputBuilder()
    .setCustomId("leave_message_input")
    .setLabel("Leave Message")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentMessage || "")
    .setPlaceholder("<mention> has left <server>")
    .setRequired(false)
    .setMaxLength(1000);

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
    .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_TIMEOUT_DM_TEXT)
    .setTitle("Edit Timeout DM Text");

  const textInput = new TextInputBuilder()
    .setCustomId("timeout_dm_text_input")
    .setLabel("Timeout DM Text")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentText || "")
    .setPlaceholder(MODERATION_DM_CUSTOM_EXAMPLES.TIMEOUT_DM_TEXT)
    .setRequired(false)
    .setMaxLength(1000);

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
    .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_WARN_DM_TEXT)
    .setTitle("Edit Warn DM Text");

  const textInput = new TextInputBuilder()
    .setCustomId("warn_dm_text_input")
    .setLabel("Warn DM Text")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentText || "")
    .setPlaceholder(MODERATION_DM_CUSTOM_EXAMPLES.WARN_DM_TEXT)
    .setRequired(false)
    .setMaxLength(1000);

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    textInput,
  );
  modal.addComponents(actionRow);

  return modal;
}

export function createBanDmTextModal(currentText: string | null): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_BAN_DM_TEXT)
    .setTitle("Edit Ban DM Text");

  const textInput = new TextInputBuilder()
    .setCustomId("ban_dm_text_input")
    .setLabel("Ban DM Text")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentText || "")
    .setPlaceholder(MODERATION_DM_CUSTOM_EXAMPLES.BAN_DM_TEXT)
    .setRequired(false)
    .setMaxLength(1000);

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    textInput,
  );
  modal.addComponents(actionRow);

  return modal;
}

export function createKickDmTextModal(
  currentText: string | null,
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(SETTINGS_CUSTOM_IDS.MODALS.EDIT_KICK_DM_TEXT)
    .setTitle("Edit Kick DM Text");

  const textInput = new TextInputBuilder()
    .setCustomId("kick_dm_text_input")
    .setLabel("Kick DM Text")
    .setStyle(TextInputStyle.Paragraph)
    .setValue(currentText || "")
    .setPlaceholder(MODERATION_DM_CUSTOM_EXAMPLES.KICK_DM_TEXT)
    .setRequired(false)
    .setMaxLength(1000);

  const actionRow = new ActionRowBuilder<TextInputBuilder>().addComponents(
    textInput,
  );
  modal.addComponents(actionRow);

  return modal;
}
