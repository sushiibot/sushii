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

const MAX_PAST_EVENTS = 3;
// TODO: add pagination so users can browse beyond the first page of events
const MAX_DISPLAYED_EVENTS = 10;
const FOOTER_TEXT = "-# All times are shown in your local timezone";

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

    // Fetch recent past events (returned most-recent-first) and reverse for display.
    const pastEvents = (await this.eventRepo.findRecentPastByGuild(guildId, now, MAX_PAST_EVENTS)).reverse();

    // Fill remaining slots with future events; fetch one extra to detect truncation.
    const futureLimit = MAX_DISPLAYED_EVENTS - pastEvents.length;
    const futureEvents = await this.eventRepo.findUpcomingByGuild(guildId, now, futureLimit + 1);

    const truncated = futureEvents.length > futureLimit;
    const displayed = [...pastEvents, ...futureEvents.slice(0, futureLimit)];

    if (displayed.length === 0) {
      const container = new ContainerBuilder()
        .setAccentColor(Color.Info)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("No events found."),
        );
      await interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const calendarIds = new Set(displayed.map((e) => e.calendarId));
    const multipleCalendars = calendarIds.size > 1;
    const accentColor = calendarIds.size === 1 ? (displayed[0].accentColor ?? Color.Info) : Color.Info;

    const container = new ContainerBuilder().setAccentColor(accentColor);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Upcoming Events"));
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    for (let i = 0; i < displayed.length; i++) {
      const { event, calendarTitle } = displayed[i];
      const date = event.getDate();
      if (!date) continue; // defensive — ensured non-null by SQL filter

      const locationIsUrl = !!event.location && URL.canParse(event.location);

      let titleLine: string;
      if (locationIsUrl) {
        const safeLocation = event.location.replace(/\)/g, "%29");
        const escapedSummary = event.summary.replace(/[\[\]]/g, "\\$&");
        titleLine = `**[${escapedSummary}](${safeLocation})**`;
      } else {
        titleLine = `**${event.summary}**`;
      }

      const absTimestamp = event.isAllDay
        ? time(date, TimestampStyles.LongDate)
        : time(date, TimestampStyles.LongDateTime);
      const timestampStr = `${absTimestamp} (${time(date, TimestampStyles.RelativeTime)})`;

      const lines: string[] = [titleLine, timestampStr];

      const meta: string[] = [];
      if (event.location && !locationIsUrl) {
        meta.push(event.location);
      }
      if (multipleCalendars) meta.push(calendarTitle);
      if (meta.length > 0) lines.push(`-# ${meta.join("  ·  ")}`);

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    const footerParts: string[] = [FOOTER_TEXT];
    if (truncated) {
      footerParts.push("-# …and more events — check the schedule channel for the full list");
    }
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(footerParts.join("\n")),
    );

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
    });
  }
}
