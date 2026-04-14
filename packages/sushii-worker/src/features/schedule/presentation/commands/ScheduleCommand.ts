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

import { toScheduleEvent } from "../../infrastructure/google/CalendarEventMapper";
import type { GoogleCalendarClient } from "../../infrastructure/google/GoogleCalendarClient";
import type { ScheduleChannelRepository } from "../../domain/repositories/ScheduleChannelRepository";
import type { ScheduleEvent } from "../../domain/entities/ScheduleEvent";

const UPCOMING_EVENT_COUNT = 10;
// How many days ahead to search for events
const LOOKAHEAD_DAYS = 90;

export class ScheduleCommand extends SlashCommandHandler {
  serverOnly = true;

  command = new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Show upcoming scheduled events for this server.")
    .toJSON();

  constructor(
    private readonly repo: ScheduleChannelRepository,
    private readonly calendarClient: GoogleCalendarClient,
    private readonly logger: Logger,
  ) {
    super();
  }

  async handler(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId) {
      await interaction.reply({ content: "This command can only be used in a server.", flags: MessageFlags.Ephemeral });
      return;
    }

    const channels = await this.repo.findAllByGuild(BigInt(interaction.guildId));

    if (channels.length === 0) {
      const container = new ContainerBuilder()
        .setAccentColor(Color.Info)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("No schedule channels are configured in this server."),
        );
      await interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const now = new Date();
    const timeMax = new Date(now.getTime() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);

    interface TaggedEvent {
      event: ScheduleEvent;
      calendarTitle: string;
    }

    const allEvents: TaggedEvent[] = [];

    await Promise.all(
      channels.map(async (sc) => {
        try {
          const response = await this.calendarClient.listEvents(sc.calendarId, {
            timeMin: now.toISOString(),
            timeMax: timeMax.toISOString(),
            orderBy: "startTime",
            maxResults: UPCOMING_EVENT_COUNT,
          });

          for (const item of response.items) {
            if (item.status === "cancelled") continue;
            const event = toScheduleEvent(item);
            if (event.getDate() !== null) {
              allEvents.push({ event, calendarTitle: sc.calendarTitle });
            }
          }
        } catch (err) {
          this.logger.warn(
            { err, calendarId: sc.calendarId, channelId: sc.channelId.toString() },
            "Failed to fetch events for schedule command",
          );
        }
      }),
    );

    // Sort combined events by date ascending, take top N
    allEvents.sort((a, b) => a.event.getDate()!.getTime() - b.event.getDate()!.getTime());
    const upcoming = allEvents.slice(0, UPCOMING_EVENT_COUNT);

    if (upcoming.length === 0) {
      const container = new ContainerBuilder()
        .setAccentColor(Color.Info)
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`No upcoming events in the next ${LOOKAHEAD_DAYS} days.`),
        );
      await interaction.reply({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }

    const multipleCalendars = channels.length > 1;

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
        // Skip URL locations — they're already used as the event link
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
