import { EmbedBuilder } from "discord.js";
import { t } from "i18next";

import dayjs from "@/shared/domain/dayjs";
import Color from "@/utils/colors";

import type { Reminder } from "../domain/entities/Reminder";

export function buildAddSuccessEmbed(reminder: Reminder): EmbedBuilder {
  const expireAtTimestamp = dayjs.utc(reminder.getExpireAt());

  return new EmbedBuilder()
    .setTitle(t("reminder.add.success.title", { ns: "commands" }))
    .setDescription(
      t("reminder.add.success.description", {
        ns: "commands",
        expireAtTimestamp: expireAtTimestamp.unix(),
        description: reminder.getDescription(),
      }),
    )
    .setFooter({
      text: `Reminder ID: ${reminder.getId()}`,
    })
    .setColor(Color.Success);
}

export function buildListEmbed(reminders: Reminder[]): EmbedBuilder {
  if (reminders.length === 0) {
    return new EmbedBuilder()
      .setTitle(t("reminder.list.success.empty_title", { ns: "commands" }))
      .setDescription(
        t("reminder.list.success.empty_description", { ns: "commands" }),
      )
      .setColor(Color.Success);
  }

  const remindersStr = reminders.map((r) => {
    const expireAtTimestamp = dayjs.utc(r.getExpireAt());
    return `\`${r.getId()}\` <t:${expireAtTimestamp.unix()}:R> - ${r.getDescription()}`;
  });

  return new EmbedBuilder()
    .setTitle(t("reminder.list.success.title", { ns: "commands" }))
    .setDescription(remindersStr.join("\n"))
    .setColor(Color.Info);
}

export function buildDeleteSuccessEmbed(reminder: Reminder): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(t("reminder.delete.success.title", { ns: "commands" }))
    .setDescription(
      t("reminder.delete.success.description", {
        ns: "commands",
        expireAtTimestamp: dayjs.utc(reminder.getExpireAt()).unix(),
        description: reminder.getDescription(),
      }),
    )
    .setFooter({
      text: `Reminder ID: ${reminder.getId()}`,
    })
    .setColor(Color.Success);
}

export function buildErrorEmbed(
  title: string,
  description?: string,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(title).setColor(Color.Error);

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

export function buildInvalidDurationEmbed(): EmbedBuilder {
  return new EmbedBuilder()
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
    .setColor(Color.Error);
}

export function buildNotFoundEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(
      t("reminder.delete.error.not_found", {
        ns: "commands",
      }),
    )
    .setColor(Color.Warning);
}
