import { sleep } from "bun";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  MessageComponentInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from "discord.js";
import type { Logger } from "pino";

import dayjs from "@/shared/domain/dayjs";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";
import parseDurationOrTimestamp from "@/utils/parseDurationOrTimestamp";

import type { ReminderService } from "../application/ReminderService";
import { buildRemindersListContainer } from "./RemindersListView";
import {
  buildAddSuccessEmbed,
  buildErrorEmbed,
  buildInvalidDurationEmbed,
} from "./RemindersView";

const COLLECTOR_IDLE_TIME = 120000; // 2 minutes
const CONFIRMATION_TIMEOUT = 60000; // 1 minute
const TEMP_MESSAGE_DISPLAY_TIME = 2500; // 2.5 seconds
const ERROR_MESSAGE_DISPLAY_TIME = 3000; // 3 seconds

export class ReminderCommand extends SlashCommandHandler {
  serverOnly = false;

  command = new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Create and manage reminders for the future.")
    .addSubcommand((c) =>
      c
        .setName("add")
        .setDescription("Set a new reminder.")
        .addStringOption((o) =>
          o
            .setName("duration")
            .setDescription("When in the future to remind you.")
            .setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName("description")
            .setDescription("Description of the reminder.")
            .setRequired(true),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("list")
        .setDescription("View and manage your pending reminders."),
    )
    .toJSON();

  constructor(
    private readonly reminderService: ReminderService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "add":
        return this.handleAdd(interaction);
      case "list":
        return this.handleList(interaction);

      default:
        throw new Error("Invalid subcommand.");
    }
  }

  private async handleAdd(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const durationStr = interaction.options.getString("duration", true);
    const description = interaction.options.getString("description", true);

    const duration = parseDurationOrTimestamp(durationStr);

    if (!duration) {
      await interaction.reply({
        embeds: [buildInvalidDurationEmbed()],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const expireAt = dayjs().utc().add(duration).toDate();

    const result = await this.reminderService.createReminder({
      userId: interaction.user.id,
      description,
      expireAt,
    });

    if (result.err) {
      await interaction.reply({
        embeds: [buildErrorEmbed("Failed to create reminder", result.val)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reminder = result.val;
    await interaction.reply({
      embeds: [buildAddSuccessEmbed(reminder)],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleList(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const reminders = await this.reminderService.listUserReminders(
      interaction.user.id,
    );

    const listMessage = buildRemindersListContainer(reminders);

    const msg = await interaction.reply({
      ...listMessage,
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      withResponse: true,
    });

    // If there are no reminders, don't set up a collector
    if (reminders.length === 0) {
      return;
    }

    if (!msg.resource?.message) {
      throw new Error("Failed to get message resource for reminder list");
    }

    const collector = msg.resource.message.createMessageComponentCollector({
      idle: COLLECTOR_IDLE_TIME,
      dispose: true,
    });

    collector.on("collect", async (i: MessageComponentInteraction) => {
      try {
        // Check if the user who clicked is the same user who ran the command
        if (i.user.id !== interaction.user.id) {
          const rejectReply = await i.reply({
            content: "Only the user who ran the command can use these buttons.",
            flags: MessageFlags.Ephemeral,
          });
          await sleep(TEMP_MESSAGE_DISPLAY_TIME);
          await rejectReply.delete();
          return;
        }

        if (i.isButton() && i.customId.startsWith("reminder_delete_")) {
          await this.handleDeleteButtonClick(i, interaction.user.id);
        }
      } catch (err) {
        this.logger.error(
          { err, userId: interaction.user.id },
          "Failed to handle reminder list interaction",
        );
      }
    });

    collector.on("end", async () => {
      try {
        // Refresh the reminder list and show with disabled buttons
        const currentReminders = await this.reminderService.listUserReminders(
          interaction.user.id,
        );
        const disabledMessage = buildRemindersListContainer(
          currentReminders,
          true,
        );

        if (msg.resource?.message) {
          await msg.resource.message.edit({
            ...disabledMessage,
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
          });
        }
      } catch (err) {
        this.logger.error(
          { err, userId: interaction.user.id },
          "Failed to disable reminder list components",
        );
      }
    });
  }

  private async handleDeleteButtonClick(
    interaction: ButtonInteraction,
    userId: string,
  ): Promise<void> {
    const reminderId = interaction.customId.replace("reminder_delete_", "");

    // Fetch the reminder to show details in confirmation
    const reminderToDelete = await this.reminderService.findReminder(
      userId,
      reminderId,
    );

    if (!reminderToDelete) {
      // Handle case where reminder was already deleted
      const errorReply = await interaction.reply({
        content:
          "This reminder no longer exists. It may have already been deleted.",
        flags: MessageFlags.Ephemeral,
      });
      await sleep(ERROR_MESSAGE_DISPLAY_TIME);
      await errorReply.delete();
      return;
    }

    // Create confirmation container
    const confirmContainer = new ContainerBuilder().setAccentColor(
      Color.Warning,
    );

    const expireTimestamp = dayjs.utc(reminderToDelete.getExpireAt()).unix();
    const confirmText = new TextDisplayBuilder().setContent(
      `Are you sure you want to delete this reminder?\n\n**${reminderToDelete.getDescription()}**\nExpires <t:${expireTimestamp}:R>`,
    );
    confirmContainer.addTextDisplayComponents(confirmText);

    const deleteButton = new ButtonBuilder()
      .setCustomId("delete")
      .setLabel("Delete")
      .setStyle(ButtonStyle.Danger);

    const cancelButton = new ButtonBuilder()
      .setCustomId("cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    const confirmationRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      deleteButton,
      cancelButton,
    );

    confirmContainer.addActionRowComponents(confirmationRow);

    const confirmReply = await interaction.reply({
      components: [confirmContainer],
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
      withResponse: true,
    });

    if (!confirmReply.resource?.message) {
      throw new Error("Failed to get confirmation message resource");
    }

    try {
      const confirmation =
        await confirmReply.resource.message.awaitMessageComponent({
          time: CONFIRMATION_TIMEOUT,
          filter: (i: MessageComponentInteraction) => i.user.id === userId,
        });

      if (confirmation.customId === "delete") {
        // Delete the reminder
        const result = await this.reminderService.deleteReminder(
          userId,
          reminderId,
        );

        if (!result.err) {
          // Fetch updated reminders
          const updatedReminders =
            await this.reminderService.listUserReminders(userId);
          const updatedMessage = buildRemindersListContainer(updatedReminders);

          // Update the original reminder list message
          await interaction.editReply({
            message: interaction.message,
            ...updatedMessage,
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
          });

          // Delete the confirmation dialog
          await interaction.deleteReply();
        } else {
          // Show error in confirmation dialog
          await confirmation.update({
            content:
              "Failed to delete reminder. It may have already been deleted.",
            components: [],
          });
        }
      } else {
        // Cancel - delete the confirmation dialog
        await interaction.deleteReply();
      }
    } catch {
      // Timeout or error - delete the confirmation dialog if it exists
      try {
        await interaction.deleteReply();
      } catch {
        // Already deleted
      }
    }
  }
}
