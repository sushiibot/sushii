import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { t } from "i18next";

import dayjs from "@/shared/domain/dayjs";

import {
  deleteReminder,
  insertReminder,
  listReminders,
} from "../../db/Reminder/Reminder.repository";
import db from "../../infrastructure/database/db";
import Color from "../../utils/colors";
import parseDurationOrTimestamp from "../../utils/parseDurationOrTimestamp";
import { SlashCommandHandler } from "../handlers";

export default class ReminderCommand extends SlashCommandHandler {
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

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case "add":
        return ReminderCommand.addHandler(interaction);
      case "list":
        return ReminderCommand.listHandler(interaction);
      case "delete":
        return ReminderCommand.deleteHandler(interaction);

      default:
        throw new Error("Invalid subcommand.");
    }
  }

  static async addHandler(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const durationStr = interaction.options.getString("duration", true);
    const description = interaction.options.getString("description", true);

    const duration = parseDurationOrTimestamp(durationStr);

    if (!duration) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              t("reminder.add.error.invalid_duration_title", {
                ns: "commands",
              }),
            )
            .setDescription(
              t("reminder.add.error.invalid_duration_description", {
                ns: "commands",
              }),
            )
            .addFields({
              name: "Note",
              value:
                "Please ensure your privacy settings allow DMs from me to receive reminders.",
            })
            .setColor(Color.Error)
            .toJSON(),
        ],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const expireAt = dayjs().utc().add(duration);

    const reminder = await insertReminder(
      db,
      interaction.user.id,
      expireAt.toDate(),
      description,
    );

    const embed = new EmbedBuilder()
      .setTitle(t("reminder.add.success.title", { ns: "commands" }))
      .setDescription(
        t("reminder.add.success.description", {
          ns: "commands",
          expireAtTimestamp: expireAt.unix(),
          description,
        }),
      )
      .setFooter({
        text: `Reminder ID: ${reminder.id}`,
      })
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [embed.toJSON()],
      flags: MessageFlags.Ephemeral,
    });
  }

  static async listHandler(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const reminders = await listReminders(db, interaction.user.id);

    const remindersStr = reminders.map((r) => {
      const expireAtTimestamp = dayjs.utc(r.expire_at);
      return `\`${r.id}\` <t:${expireAtTimestamp.unix()}:R> - ${r.description}`;
    });

    if (!remindersStr || remindersStr.length === 0) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              t("reminder.list.success.empty_title", { ns: "commands" }),
            )
            .setDescription(
              t("reminder.list.success.empty_description", { ns: "commands" }),
            )
            .setColor(Color.Success)
            .toJSON(),
        ],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(t("reminder.list.success.title", { ns: "commands" }))
      .setDescription(remindersStr.join("\n"))
      .setColor(Color.Info);

    await interaction.reply({
      embeds: [embed.toJSON()],
      flags: MessageFlags.Ephemeral,
    });
  }

  static async deleteHandler(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    const reminderId = interaction.options.getString("reminder_id", true);

    const deletedReminder = await deleteReminder(
      db,
      interaction.user.id,
      reminderId,
    );

    if (!deletedReminder) {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              t("reminder.delete.error.not_found", {
                ns: "commands",
              }),
            )
            .setColor(Color.Warning)
            .toJSON(),
        ],
        flags: MessageFlags.Ephemeral,
      });

      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(t("reminder.delete.success.title", { ns: "commands" }))
      .setDescription(
        t("reminder.delete.success.description", {
          ns: "commands",
          expireAtTimestamp: dayjs.utc(deletedReminder?.expire_at).unix(),
          description: deletedReminder?.description || "unknown",
        }),
      )
      .setFooter({
        text: `Reminder ID: ${deletedReminder.id}`,
      })
      .setColor(Color.Success);

    await interaction.reply({
      embeds: [embed.toJSON()],
      flags: MessageFlags.Ephemeral,
    });
  }
}
