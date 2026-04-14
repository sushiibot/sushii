import {
  ChatInputCommandInteraction,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  time,
  TimestampStyles,
} from "discord.js";
import type { Logger } from "pino";

import { SlashCommandHandler } from "@/shared/presentation/handlers";
import Color from "@/utils/colors";

import type { ScheduleEventRepository } from "../../domain/repositories/ScheduleEventRepository";

const UPCOMING_DAYS = 21;

export class ScheduleCommand extends SlashCommandHandler {
  serverOnly = true;

  command = new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Show upcoming scheduled events for this server.")
    .toJSON();

  constructor(
    private readonly eventRepo: ScheduleEventRepository,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const guildId = BigInt(interaction.guildId);
    const now = new Date();
    const to = new Date(now.getTime() + UPCOMING_DAYS * 24 * 60 * 60 * 1000);

    const upcoming = await this.eventRepo.findUpcomingByGuild(guildId, now, to);

    if (upcoming.length === 0) {
      const container = new ContainerBuilder()
        .setAccentColor(Color.Info)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`No upcoming events in the next ${UPCOMING_DAYS} days.`),
        );
      await interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const multipleCalendars = new Set(upcoming.map((e) => e.calendarId)).size > 1;

    const container = new ContainerBuilder().setAccentColor(Color.Info);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Upcoming Events"));
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    for (let i = 0; i < upcoming.length; i++) {
      const { event, calendarTitle } = upcoming[i];
      const date = event.getDate()!;

      const titleLine = event.url
        ? `**[${event.summary}](${event.url})**`
        : `**${event.summary}**`;

      const timestampStr = event.isAllDay
        ? time(date, TimestampStyles.LongDate)
        : time(date, TimestampStyles.LongDateTime);

      const lines: string[] = [titleLine, timestampStr];

      const meta: string[] = [];
      if (event.location) {
        try {
          new URL(event.location);
        } catch {
          meta.push(event.location);
        }
      }
      if (multipleCalendars) meta.push(calendarTitle);
      if (meta.length > 0) lines.push(`-# ${meta.join("  ·  ")}`);

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );

      if (i < upcoming.length - 1) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
        );
      }
    }

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
