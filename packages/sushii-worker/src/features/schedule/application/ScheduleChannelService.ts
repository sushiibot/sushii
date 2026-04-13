import type { Client, TextChannel } from "discord.js";
import type { Logger } from "pino";
import { Ok, Err } from "ts-results";
import type { Result } from "ts-results";

import type { ScheduleChannel } from "../domain/entities/ScheduleChannel";
import type { ScheduleChannelRepository } from "../domain/repositories/ScheduleChannelRepository";
import { parseCalendarId } from "../infrastructure/google/CalendarIdParser";
import {
  GoogleCalendarClient,
  GoogleCalendarError,
} from "../infrastructure/google/GoogleCalendarClient";
import type { SchedulePollService } from "./SchedulePollService";

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
    private readonly repo: ScheduleChannelRepository,
    private readonly calendarClient: GoogleCalendarClient,
    private readonly schedulePollService: SchedulePollService,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  async configure(input: ConfigureScheduleChannelInput): Promise<Result<ScheduleChannel, string>> {
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
        if (err.statusCode === 403 || err.statusCode === 404) {
          return Err(
            "The calendar is not publicly accessible. Please make the Google Calendar public and try again.",
          );
        }
      }
      // Re-throw unexpected errors — let the presentation layer handle them
      throw err;
    }

    const calendarTitle = input.title ?? metadata.summary;

    const channel = await this.repo.upsert({
      guildId: input.guildId,
      channelId: input.channelId,
      logChannelId: input.logChannelId,
      configuredByUserId: input.configuredByUserId,
      calendarId,
      calendarTitle,
      nextPollAt: new Date(),
    });

    // Post confirmation to log channel
    try {
      const logChannel = await this.client.channels.fetch(
        input.logChannelId.toString(),
      );
      if (!logChannel?.isTextBased() || logChannel.isDMBased()) return Ok(channel);
      const intervalMin = Math.round(channel.pollIntervalSec / 60);
      const intervalDisplay = intervalMin >= 1
        ? `every ${intervalMin} minute${intervalMin !== 1 ? "s" : ""}`
        : `every ${channel.pollIntervalSec} seconds`;
      await logChannel.send({
        content: `✅ Schedule channel configured: <#${input.channelId}> will now sync **${calendarTitle}** ${intervalDisplay}.`,
      });
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: input.logChannelId.toString() },
        "Failed to post configuration confirmation to log channel",
      );
    }

    return Ok(channel);
  }

  async remove(guildId: bigint, channelId: bigint): Promise<Result<void, string>> {
    const existing = await this.repo.findByChannel(guildId, channelId);
    if (!existing) {
      return Err("No schedule channel is configured for that channel.");
    }

    await this.repo.delete(guildId, channelId);
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
