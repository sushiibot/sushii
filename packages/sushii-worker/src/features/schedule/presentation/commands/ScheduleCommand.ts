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

import type { ScheduleChannelService } from "../../application/ScheduleChannelService";
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
    .addStringOption((o) =>
      o
        .setName("calendar")
        .setDescription("Which schedule to show. Defaults to the server's primary schedule.")
        .setAutocomplete(true)
        .setRequired(false),
    )
    .toJSON();

  constructor(
    private readonly eventRepo: ScheduleEventRepository,
    private readonly scheduleChannelService: ScheduleChannelService,
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

    const calendarInput = interaction.options.getString("calendar");

    let calendarId: string;
    let isFiltered: boolean;
    let filterTitle: string | null = null;

    let hasMultiple: boolean;

    if (calendarInput) {
      // Validate: the provided calendarId must belong to this guild
      const allSchedules = await this.scheduleChannelService.listForGuild(guildId);
      const schedule = allSchedules.find((s) => s.calendarId === calendarInput) ?? null;

      if (!schedule) {
        const container = new ContainerBuilder()
          .setAccentColor(Color.Error)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("That schedule was not found in this server."),
          );
        await interaction.reply({
          components: [container],
          flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        });
        return;
      }

      calendarId = schedule.calendarId;
      isFiltered = true;
      hasMultiple = allSchedules.length > 1;
    } else {
      const defaultSchedule = await this.scheduleChannelService.getDefault(guildId);

      if (!defaultSchedule) {
        const container = new ContainerBuilder()
          .setAccentColor(Color.Info)
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("No schedules are configured in this server."),
          );
        await interaction.reply({
          components: [container],
          flags: MessageFlags.IsComponentsV2,
        });
        return;
      }

      const allSchedules = await this.scheduleChannelService.listForGuild(guildId);
      calendarId = defaultSchedule.calendarId;
      filterTitle = defaultSchedule.displayTitle;
      isFiltered = false;
      hasMultiple = allSchedules.length > 1;
    }

    const events = await this.eventRepo.findUpcomingByCalendar(guildId, calendarId, now, MAX_FETCH_EVENTS + 1);
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

    const accentColor = displayed[0].accentColor ?? Color.Info;

    const container = new ContainerBuilder().setAccentColor(accentColor);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Events"));
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    for (let i = 0; i < displayed.length; i++) {
      const { event } = displayed[i];
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

      if (event.location && !locationIsUrl) {
        lines.push(`-# ${event.location}`);
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
      footerParts.push(`-# …and ${remainingCount}${suffix} more ${noun}. Check the schedule channel for the full list.`);
    }
    if (!isFiltered && hasMultiple && filterTitle) {
      footerParts.push(`-# Viewing: ${filterTitle}. Use \`/schedule calendar\` to see other schedules.`);
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
