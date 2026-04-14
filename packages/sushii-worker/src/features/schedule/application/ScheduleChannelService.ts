import type { Logger } from "pino";
import { Ok, Err } from "ts-results";
import type { Result } from "ts-results";

import type { Schedule } from "../domain/entities/Schedule";
import type { ScheduleRepository } from "../domain/repositories/ScheduleRepository";
import type { ScheduleMessageRepository } from "../domain/repositories/ScheduleMessageRepository";
import { parseCalendarId } from "../infrastructure/google/CalendarIdParser";
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from "../infrastructure/google/GoogleCalendarClient";

export interface ConfigureScheduleChannelInput {
  guildId: bigint;
  channelId: bigint;
  logChannelId: bigint;
  configuredByUserId: bigint;
  calendarInput: string;
  title: string;
}

const MAX_SCHEDULES_PER_GUILD = 3;

export class ScheduleChannelService {
  constructor(
    private readonly repo: ScheduleRepository & ScheduleMessageRepository,
    private readonly calendarClient: GoogleCalendarClient,
    private readonly isConfigured: boolean,
    private readonly logger: Logger,
  ) {}

  async configure(input: ConfigureScheduleChannelInput): Promise<Result<Schedule, string>> {
    if (!this.isConfigured) {
      return Err("Schedule sync is not configured on this bot. The `GOOGLE_CALENDAR_API_KEY` environment variable is not set.");
    }

    const calendarId = parseCalendarId(input.calendarInput);
    if (!calendarId) {
      return Err(
        "Could not parse a Google Calendar ID from that input. Please provide a valid Google Calendar URL or raw calendar ID (e.g. `example@group.calendar.google.com`).",
      );
    }

    const existing = await this.repo.findAllByGuild(input.guildId);
    const isUpdate = existing.some(
      (s) => s.channelId === input.channelId || s.calendarId === calendarId,
    );
    if (!isUpdate && existing.length >= MAX_SCHEDULES_PER_GUILD) {
      return Err(
        `This server has reached the maximum of ${MAX_SCHEDULES_PER_GUILD} schedule channels. Remove one before adding another.`,
      );
    }

    let metadata: { summary: string; timeZone: string };
    try {
      metadata = await this.calendarClient.getCalendarMetadata(calendarId);
    } catch (err) {
      if (err instanceof GoogleCalendarError) {
        if (err.statusCode === 401 || err.statusCode === 403 || err.statusCode === 404) {
          return Err(
            "The calendar is not publicly accessible. Please make the Google Calendar public and try again.",
          );
        }
      }
      throw err;
    }

    const calendarTitle = metadata.summary;
    const displayTitle = input.title.trim() || null;

    // If this channel previously had a different calendar, delete the old row first
    // so the channel_id UNIQUE constraint doesn't fire on the new insert.
    const conflictingByChannel = existing.find(
      (s) => s.channelId === input.channelId && s.calendarId !== calendarId,
    );
    if (conflictingByChannel) {
      await this.repo.delete(input.guildId, conflictingByChannel.calendarId);
    }

    const schedule = await this.repo.upsert({
      guildId: input.guildId,
      calendarId,
      channelId: input.channelId,
      logChannelId: input.logChannelId,
      configuredByUserId: input.configuredByUserId,
      calendarTitle,
      displayTitle,
      nextPollAt: new Date(),
    });

    return Ok(schedule);
  }

  async remove(guildId: bigint, channelId: bigint): Promise<Result<void, string>> {
    const existing = await this.repo.findByChannel(guildId, channelId);
    if (!existing) {
      return Err("No schedule channel is configured for that channel.");
    }

    await this.repo.delete(guildId, existing.calendarId);
    return Ok(undefined);
  }

  async refresh(guildId: bigint, channelId: bigint): Promise<Result<void, string>> {
    const existing = await this.repo.findByChannel(guildId, channelId);
    if (!existing) {
      return Err("No schedule channel is configured for that channel.");
    }

    const now = new Date();
    await this.repo.updateSyncToken(guildId, existing.calendarId, null, now);

    await this.repo.clearContentHashes(
      guildId,
      existing.calendarId,
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
    );

    return Ok(undefined);
  }

  async listForGuild(guildId: bigint): Promise<Schedule[]> {
    return this.repo.findAllByGuild(guildId);
  }
}
