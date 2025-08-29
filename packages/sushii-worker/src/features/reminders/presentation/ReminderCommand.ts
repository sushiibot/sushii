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
import { ComponentsV2Paginator } from "@/shared/presentation/ComponentsV2Paginator";
import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";
import parseDurationOrTimestamp from "@/utils/parseDurationOrTimestamp";

import type { ReminderService } from "../application/ReminderService";
import type { Reminder } from "../domain/entities/Reminder";
import { buildRemindersContainer } from "./RemindersListView";
import {
  buildAddSuccessEmbed,
  buildErrorEmbed,
  buildInvalidDurationEmbed,
} from "./RemindersView";

const COLLECTOR_IDLE_TIME = 120000; // 2 minutes
const CONFIRMATION_TIMEOUT = 60000; // 1 minute
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
        return this.handleList(
          interaction as ChatInputCommandInteraction<"cached">,
        );

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

    const expireAt = dayjs.utc().add(duration).toDate();

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
    interaction: ChatInputCommandInteraction<"cached">,
  ): Promise<void> {
    const paginator = new ComponentsV2Paginator<Reminder>({
      interaction,
      pageSize: 10,
      config: {
        ephemeral: true,
      },
      callbacks: {
        fetchPage: async (pageIndex, pageSize) => {
          return this.reminderService.listUserRemindersPaginated(
            interaction.user.id,
            pageIndex,
            pageSize,
          );
        },

        getTotalCount: async () => {
          return this.reminderService.countUserReminders(interaction.user.id);
        },

        renderContainer: (reminders, state, navButtons) => {
          return buildRemindersContainer(
            reminders,
            navButtons,
            state.isDisabled,
          );
        },
      },
    });

    // Set up separate collector for delete buttons first
    this.setupDeleteButtonCollector(interaction, paginator);

    // Start the paginator and wait for it to complete
    await paginator.start(true);

    // Once paginator is done, the delete collector will also be cleaned up automatically
  }

  private async setupDeleteButtonCollector(
    interaction: ChatInputCommandInteraction<"cached">,
    paginator: ComponentsV2Paginator<Reminder>,
  ): Promise<void> {
    const response = await interaction.fetchReply();
    const deleteCollector = response.createMessageComponentCollector({
      idle: COLLECTOR_IDLE_TIME,
    });

    deleteCollector.on("collect", async (i) => {
      try {
        // Ephemeral so we don't need to check user permissions
        if (i.isButton() && i.customId.startsWith("reminder_delete_")) {
          await this.handleDeleteButtonClick(i, interaction.user.id, paginator);
        }
      } catch (err) {
        this.logger.error(
          { err, userId: interaction.user.id },
          "Failed to handle reminder delete interaction",
        );
      }
    });
  }

  private async handleDeleteButtonClick(
    interaction: ButtonInteraction,
    userId: string,
    paginator: ComponentsV2Paginator<Reminder>,
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

    const confirmContent =
      `### Are you sure you want to delete this reminder?` +
      `\n**Expires <t:${expireTimestamp}:R>**` +
      `\n> ${reminderToDelete.getDescription()}`;
    const confirmText = new TextDisplayBuilder().setContent(confirmContent);
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
          // Trigger a full refresh with updated total count and page adjustment
          const updatedMessage = await paginator.refresh();
          await interaction.editReply({
            message: interaction.message,
            ...updatedMessage,
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
