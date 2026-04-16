import type { Logger } from "pino";
import { Ok, Err } from "ts-results";
import type { Result } from "ts-results";

import type { Schedule } from "../domain/entities/Schedule";
import type { ScheduleRepository, UpdateScheduleSettingsData } from "../domain/repositories/ScheduleRepository";
import type { ScheduleMessageRepository } from "../domain/repositories/ScheduleMessageRepository";

export interface EditScheduleChannelInput {
  guildId: bigint;
  /** Current channelId — used to identify which schedule to edit */
  channelId: bigint;
  editedByUserId: bigint;
  newDisplayTitle: string;
  newChannelId: bigint;
  newLogChannelId: bigint;
  newAccentColor?: number | null;
}

export type EditScheduleChangedField = "displayTitle" | "channelId" | "logChannelId" | "accentColor";

export interface EditScheduleResult {
  schedule: Schedule;
  changedFields: EditScheduleChangedField[];
}
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
  accentColor?: number | null;
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

    const channelConflict = existing.find((s) => s.channelId === input.channelId);
    if (channelConflict) {
      return Err(
        `<#${input.channelId}> is already syncing **${channelConflict.displayTitle}**. ` +
          `Run \`/schedule-config remove\` on that channel first, then try again.`,
      );
    }

    const calendarConflict = existing.find((s) => s.calendarId === calendarId);
    if (calendarConflict) {
      return Err(
        `That calendar is already syncing to <#${calendarConflict.channelId}>. ` +
          `Run \`/schedule-config remove\` on that channel first.`,
      );
    }

    if (existing.length >= MAX_SCHEDULES_PER_GUILD) {
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
    const displayTitle = input.title.trim();
    if (!displayTitle) {
      return Err("Schedule name cannot be blank.");
    }

    const schedule = await this.repo.upsert({
      guildId: input.guildId,
      calendarId,
      channelId: input.channelId,
      logChannelId: input.logChannelId,
      configuredByUserId: input.configuredByUserId,
      calendarTitle,
      displayTitle,
      accentColor: input.accentColor ?? null,
      nextPollAt: new Date(),
    });

    this.logger.info(
      {
        guildId: input.guildId.toString(),
        calendarId,
        channelId: input.channelId.toString(),
        logChannelId: input.logChannelId.toString(),
        calendarTitle,
        displayTitle,
      },
      "Schedule channel configured",
    );

    return Ok(schedule);
  }

  async remove(guildId: bigint, channelId: bigint): Promise<Result<void, string>> {
    const existing = await this.repo.findByChannel(guildId, channelId);
    if (!existing) {
      return Err("No schedule channel is configured for that channel.");
    }

    await this.repo.delete(guildId, existing.calendarId);

    this.logger.info(
      { guildId: guildId.toString(), channelId: channelId.toString(), calendarId: existing.calendarId },
      "Schedule channel removed",
    );

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

    this.logger.info(
      { guildId: guildId.toString(), channelId: channelId.toString(), calendarId: existing.calendarId },
      "Schedule channel refresh queued (sync token and content hashes cleared)",
    );

    return Ok(undefined);
  }

  async getByChannel(guildId: bigint, channelId: bigint): Promise<Schedule | null> {
    return this.repo.findByChannel(guildId, channelId);
  }

  async listForGuild(guildId: bigint): Promise<Schedule[]> {
    return this.repo.findAllByGuild(guildId);
  }

  async edit(input: EditScheduleChannelInput): Promise<Result<EditScheduleResult, string>> {
    const existing = await this.repo.findByChannel(input.guildId, input.channelId);
    if (!existing) {
      return Err("No schedule channel is configured for that channel.");
    }

    const newTitle = input.newDisplayTitle.trim();
    if (!newTitle) {
      return Err("Schedule name cannot be blank.");
    }

    const changedFields: EditScheduleChangedField[] = [];
    const patch: UpdateScheduleSettingsData = {};

    if (newTitle !== existing.displayTitle) {
      patch.displayTitle = newTitle;
      changedFields.push("displayTitle");
    }

    const channelChanged = input.newChannelId !== existing.channelId;
    if (channelChanged) {
      const channelConflict = await this.repo.findByChannel(input.guildId, input.newChannelId);
      if (channelConflict) {
        return Err(
          `<#${input.newChannelId}> is already syncing **${channelConflict.displayTitle}**. ` +
            `Run \`/schedule-config remove\` on that channel first, then try again.`,
        );
      }
      patch.channelId = input.newChannelId;
      patch.nextPollAt = new Date();
      changedFields.push("channelId");
    }

    if (input.newLogChannelId !== existing.logChannelId) {
      patch.logChannelId = input.newLogChannelId;
      changedFields.push("logChannelId");
    }

    if ("newAccentColor" in input && input.newAccentColor !== existing.accentColor) {
      patch.accentColor = input.newAccentColor ?? null;
      changedFields.push("accentColor");
    }

    if (changedFields.length === 0) {
      return Err("No changes were made.");
    }

    // Visual-only changes (title, color) need an immediate poll to re-render messages.
    // Channel changes already set nextPollAt above.
    const needsImmediateRerender =
      (changedFields.includes("displayTitle") || changedFields.includes("accentColor")) && !channelChanged;
    if (needsImmediateRerender) {
      patch.nextPollAt = new Date();
    }

    if (channelChanged) {
      await this.repo.deleteAllMessages(input.guildId, existing.calendarId);
    }

    const schedule = await this.repo.updateSettings(input.guildId, existing.calendarId, patch);

    this.logger.info(
      {
        guildId: input.guildId.toString(),
        calendarId: existing.calendarId,
        oldChannelId: existing.channelId.toString(),
        editedByUserId: input.editedByUserId.toString(),
        changedFields,
      },
      "Schedule channel settings updated",
    );

    return Ok({ schedule, changedFields });
  }
}
