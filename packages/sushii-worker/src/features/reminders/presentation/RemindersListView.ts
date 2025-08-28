import type { ActionRowBuilder } from "discord.js";
import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
} from "discord.js";

import dayjs from "@/shared/domain/dayjs";
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import Color from "@/utils/colors";

import type { Reminder } from "../domain/entities/Reminder";

export interface RemindersListViewResult {
  components: ContainerBuilder[];
  flags: MessageFlags.IsComponentsV2;
  allowedMentions: { parse: [] };
}

/**
 * Stateless function to build reminders container for pagination
 */
export function buildRemindersContainer(
  reminders: Reminder[],
  navButtons: ActionRowBuilder<ButtonBuilder> | null,
  isDisabled = false,
): ContainerBuilder {
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
        `**Expires <t:${expireTimestamp}:R> – <t:${expireTimestamp}:f>**` +
        `\n> ${reminder.getDescription()}`;

      const reminderText = new TextDisplayBuilder().setContent(
        reminderTextContent,
      );

      const deleteButton = new ButtonBuilder()
        .setCustomId(`reminder_delete_${reminder.getId()}`)
        .setLabel("Delete")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(isDisabled);

      const section = new SectionBuilder()
        .addTextDisplayComponents(reminderText)
        .setButtonAccessory(deleteButton);

      container.addSectionComponents(section);
    }
  }

  // Add navigation using helper
  ComponentsV2Paginator.addNavigationSection(container, navButtons, isDisabled);

  return container;
}

/**
 * Legacy function for backward compatibility (non-paginated)
 */
export function buildRemindersListContainer(
  reminders: Reminder[],
  disabled = false,
): RemindersListViewResult {
  const container = buildRemindersContainer(reminders, null, disabled);

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}
