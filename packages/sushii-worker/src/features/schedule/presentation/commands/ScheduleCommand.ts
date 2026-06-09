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
import { SCHEDULE_ALL_VALUE } from "../autocompletes/ScheduleAutocomplete";

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

    // showAll: whether to merge events from all calendars
    let showAll = false;
    let filterTitle: string | null = null;
    // Resolved calendar ID used for event fetch (may differ from calendarInput when using default)
    let effectiveCalendarId: string | null = calendarInput;

    const allSchedules = await this.scheduleChannelService.listForGuild(guildId);
    if (allSchedules.length === 0) {
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
    const hasMultiple = allSchedules.length > 1;

    if (calendarInput === SCHEDULE_ALL_VALUE) {
      showAll = true;
    } else if (calendarInput) {
      // Validate: the provided calendarId must belong to this guild
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
    } else {
      const defaultSchedule = await this.scheduleChannelService.getDefault(guildId);

      effectiveCalendarId = defaultSchedule!.calendarId;
      filterTitle = defaultSchedule!.displayTitle;
    }

    const events = showAll
      ? await this.eventRepo.findUpcomingByGuild(guildId, now, MAX_FETCH_EVENTS + 1)
      : await this.eventRepo.findUpcomingByCalendar(guildId, effectiveCalendarId!, now, MAX_FETCH_EVENTS + 1);
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

    const accentColor = showAll ? Color.Info : (displayed[0].accentColor ?? Color.Info);

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
      if (showAll && hasMultiple) {
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
      footerParts.push(`-# …and ${remainingCount}${suffix} more ${noun}. Check the schedule channel for the full list.`);
    }
    if (!calendarInput && hasMultiple && filterTitle) {
      footerParts.push(`-# Viewing: ${filterTitle}. Use \`/schedule [calendar]\` to see other schedules.`);
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
