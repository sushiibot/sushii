import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";

import type { Reminder } from "../domain/entities/Reminder";

export interface RemindersListViewResult {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
}

export function buildRemindersListContainer(
  reminders: Reminder[],
  disabled = false,
): RemindersListViewResult {
  const container = new ContainerBuilder().setAccentColor(Color.Info);

  // Add header
  const headerText = new TextDisplayBuilder().setContent("## Your Reminders");
  container.addTextDisplayComponents(headerText);

  if (reminders.length === 0) {
    // Empty state
    const emptyText = new TextDisplayBuilder().setContent(
      "You have no reminders! Use `/reminder add` to create one.",
    );
    container.addTextDisplayComponents(emptyText);
  } else {
    // Add a section for each reminder
    for (const reminder of reminders) {
      const expireTimestamp = dayjs.utc(reminder.getExpireAt()).unix();

      const reminderTextContent =
        `Expires <t:${expireTimestamp}:R> – <t:${expireTimestamp}:f>` +
        `\n> ${reminder.getDescription()}`;

      const reminderText = new TextDisplayBuilder().setContent(
        reminderTextContent,
      );

      const deleteButton = new ButtonBuilder()
        .setCustomId(`reminder_delete_${reminder.getId()}`)
        .setLabel("Delete")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(disabled);

      const section = new SectionBuilder()
        .addTextDisplayComponents(reminderText)
        .setButtonAccessory(deleteButton);

      container.addSectionComponents(section);
    }
  }

  // Add footer when disabled
  if (disabled) {
    const footerText = new TextDisplayBuilder().setContent(
      "-# Session expired after 2 minutes of inactivity. Re-run `/reminder list` to manage reminders.",
    );
    container.addTextDisplayComponents(footerText);
  }

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
