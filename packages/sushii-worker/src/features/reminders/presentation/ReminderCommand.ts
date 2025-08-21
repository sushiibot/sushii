import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags, SlashCommandBuilder } from "discord.js";

import { SlashCommandHandler } from "@/interactions/handlers";
import dayjs from "@/shared/domain/dayjs";
import parseDurationOrTimestamp from "@/utils/parseDurationOrTimestamp";

import type { ReminderService } from "../application/ReminderService";
import {
  buildAddSuccessEmbed,
  buildDeleteSuccessEmbed,
  buildErrorEmbed,
  buildInvalidDurationEmbed,
  buildListEmbed,
  buildNotFoundEmbed,
} from "./RemindersView";

export class ReminderCommand extends SlashCommandHandler {
  serverOnly = false;

  command = new SlashCommandBuilder()
    .setName("reminder")
    .setDescription("Set reminders for the future.")
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
      c.setName("list").setDescription("List all of your pending reminders."),
    )
    .addSubcommand((c) =>
      c
        .setName("delete")
        .setDescription("Delete a reminder.")
        .addStringOption((o) =>
          o
            .setName("reminder_id")
            .setDescription(
              "Specify the reminder ID (number in /reminder list), or pick from the autocomplete.",
            )
            .setRequired(true)
            .setAutocomplete(true),
        ),
    )
    .toJSON();

  constructor(private readonly reminderService: ReminderService) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case "add":
        return this.handleAdd(interaction);
      case "list":
        return this.handleList(interaction);
      case "delete":
        return this.handleDelete(interaction);

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

    await interaction.reply({
      embeds: [buildListEmbed(reminders)],
      flags: MessageFlags.Ephemeral,
    });
  }

  private async handleDelete(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const reminderId = interaction.options.getString("reminder_id", true);

    const result = await this.reminderService.deleteReminder(
      interaction.user.id,
      reminderId,
    );

    if (result.err) {
      await interaction.reply({
        embeds: [buildNotFoundEmbed()],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const deletedReminder = result.val;
    if (!deletedReminder) {
      await interaction.reply({
        embeds: [buildNotFoundEmbed()],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [buildDeleteSuccessEmbed(deletedReminder)],
      flags: MessageFlags.Ephemeral,
    });
  }
}
