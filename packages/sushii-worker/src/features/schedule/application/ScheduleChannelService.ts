import type { Logger } from "pino";
import { Ok, Err } from "ts-results";
import type { Result } from "ts-results";

import type { ScheduleChannel } from "../domain/entities/ScheduleChannel";
import type { ScheduleChannelRepository } from "../domain/repositories/ScheduleChannelRepository";
import type { ScheduleMessageRepository } from "../domain/repositories/ScheduleMessageRepository";
import { parseCalendarId } from "../infrastructure/google/CalendarIdParser";
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from "../infrastructure/google/GoogleCalendarClient";
import type { SchedulePollService } from "./SchedulePollService";

export function formatPollInterval(pollIntervalSec: number): string {
  const intervalMin = Math.floor(pollIntervalSec / 60);
  return intervalMin >= 1
    ? `every ${intervalMin} minute${intervalMin !== 1 ? "s" : ""}`
    : `every ${pollIntervalSec} seconds`;
}

export interface ConfigureScheduleChannelInput {
  guildId: bigint;
  channelId: bigint;
  logChannelId: bigint;
  configuredByUserId: bigint;
  calendarInput: string;
  title?: string;
}

export class ScheduleChannelService {
  constructor(
    private readonly repo: ScheduleChannelRepository & ScheduleMessageRepository,
    private readonly calendarClient: GoogleCalendarClient,
    private readonly schedulePollService: SchedulePollService,
    private readonly isConfigured: boolean,
    private readonly logger: Logger,
  ) {}

  async configure(input: ConfigureScheduleChannelInput): Promise<Result<ScheduleChannel, string>> {
    if (!this.isConfigured) {
      return Err("Schedule sync is not configured on this bot. The `GOOGLE_CALENDAR_API_KEY` environment variable is not set.");
    }

    const calendarId = parseCalendarId(input.calendarInput);
    if (!calendarId) {
      return Err(
        "Could not parse a Google Calendar ID from that input. Please provide a valid Google Calendar URL or raw calendar ID (e.g. `example@group.calendar.google.com`).",
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
      // Re-throw unexpected errors — let the presentation layer handle them
      throw err;
    }

    const calendarTitle = metadata.summary;          // always the Google Calendar name
    // undefined = not provided by user (don't overwrite existing); string|null = explicit set
    const displayTitle = input.title !== undefined ? (input.title.trim() || null) : undefined;

    const channel = await this.repo.upsert({
      guildId: input.guildId,
      channelId: input.channelId,
      logChannelId: input.logChannelId,
      configuredByUserId: input.configuredByUserId,
      calendarId,
      calendarTitle,
      displayTitle,
      nextPollAt: new Date(),
    });

    this.schedulePollService.clearCache(channel);

    return Ok(channel);
  }

  async remove(guildId: bigint, channelId: bigint): Promise<Result<void, string>> {
    const existing = await this.repo.findByChannel(guildId, channelId);
    if (!existing) {
      return Err("No schedule channel is configured for that channel.");
    }

    await this.repo.delete(guildId, channelId);
    this.schedulePollService.clearCache(existing);
    return Ok(undefined);
  }

  async refresh(guildId: bigint, channelId: bigint): Promise<Result<void, string>> {
    const existing = await this.repo.findByChannel(guildId, channelId);
    if (!existing) {
      return Err("No schedule channel is configured for that channel.");
    }

    const now = new Date();
    await this.repo.updateSyncToken(guildId, channelId, null, now);

    // Clear content hashes for current month to force re-render
    await this.repo.clearContentHashes(
      guildId,
      channelId,
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
    );

    this.schedulePollService.clearCache(existing);

    return Ok(undefined);
  }

  async listForGuild(guildId: bigint): Promise<ScheduleChannel[]> {
    return this.repo.findAllByGuild(guildId);
  }
}
