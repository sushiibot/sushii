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

// TODO: add pagination so users can browse beyond the first page of events
const MAX_DISPLAYED_EVENTS = 10;
// Fetch up to this many events so we can show an accurate "N more" count
const MAX_FETCH_EVENTS = 50;
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

    const events = await this.eventRepo.findUpcomingByGuild(guildId, now, MAX_FETCH_EVENTS + 1);
    const truncated = events.length > MAX_FETCH_EVENTS;
    const countable = truncated ? events.slice(0, MAX_FETCH_EVENTS) : events;
    const displayed = countable.slice(0, MAX_DISPLAYED_EVENTS);
    const remainingCount = countable.length - displayed.length;

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

    const calendarIds = new Set(displayed.map((ev) => ev.calendarId));
    const multipleCalendars = calendarIds.size > 1;
    const accentColor = calendarIds.size === 1 ? (displayed[0].accentColor ?? Color.Info) : Color.Info;

    const container = new ContainerBuilder().setAccentColor(accentColor);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Events"));
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    for (let i = 0; i < displayed.length; i++) {
      const { event, calendarTitle } = displayed[i];
      const date = event.getDate();
      if (!date) {
        continue; // defensive — ensured non-null by SQL filter
      }

      let parsed: URL | null = null;
      try {
        parsed = event.location ? new URL(event.location) : null;
      } catch {
        // ignore unparseable locations
      }
      const locationIsUrl = parsed?.protocol === "http:" || parsed?.protocol === "https:";

      let titleLine: string;
      if (locationIsUrl && parsed) {
        const safeLocation = parsed.href.replace(/\)/g, "%29");
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
      if (multipleCalendars) {
        meta.push(calendarTitle);
      }
      if (meta.length > 0) {
        lines.push(`-# ${meta.join("  ·  ")}`);
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
    }

    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    const footerParts: string[] = [FOOTER_TEXT];
    if (remainingCount > 0) {
      const suffix = truncated ? "+" : "";
      const noun = remainingCount === 1 ? "event" : "events";
      footerParts.push(`-# …and ${remainingCount}${suffix} more ${noun} — check the schedule channel for the full list`);
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
