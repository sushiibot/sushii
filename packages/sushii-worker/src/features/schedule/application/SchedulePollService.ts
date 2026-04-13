import type { Client, GuildTextBasedChannel } from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import type { Logger } from "pino";

import { Semaphore } from "@/shared/infrastructure/concurrency/Semaphore";
import type { ScheduleChannel } from "../domain/entities/ScheduleChannel";
import type { ScheduleChannelMessage } from "../domain/entities/ScheduleChannelMessage";
import type { ScheduleEvent } from "../domain/entities/ScheduleEvent";
import type { ScheduleChannelRepository } from "../domain/repositories/ScheduleChannelRepository";
import { renderSchedule } from "../domain/services/ScheduleRenderService";
import type {
  GoogleCalendarClient,
  CalendarEventItem,
} from "../infrastructure/google/GoogleCalendarClient";
import { GoogleCalendarError } from "../infrastructure/google/GoogleCalendarClient";

const ALERT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours

function mapCalendarItemToEvent(item: CalendarEventItem): ScheduleEvent {
  const isAllDay = Boolean(item.start?.date && !item.start?.dateTime);
  const startUtc = item.start?.dateTime ? new Date(item.start.dateTime) : null;
  const startDate = item.start?.date ?? null;

  return {
    id: item.id,
    summary: item.summary ?? "(no title)",
    startUtc,
    startDate,
    isAllDay,
    url: item.htmlLink ?? null,
    location: item.location ?? null,
    status: item.status,
  };
}

function computeNextPollAt(intervalSec: number): Date {
  return new Date(Date.now() + intervalSec * 1000);
}

function computeBackoffNextPollAt(
  intervalSec: number,
  consecutiveFailures: number,
): Date {
  const cappedFailures = Math.min(consecutiveFailures, 10);
  // Backoff is capped at 1 hour regardless of intervalSec.
  // If intervalSec >= 3600, there is no escalation — this is intentional.
  const backoffSec = Math.min(
    intervalSec * Math.pow(2, cappedFailures),
    3600,
  );
  return new Date(Date.now() + backoffSec * 1000);
}

function isSameMonth(date: Date, year: number, month: number): boolean {
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
}

/**
 * Returns the effective Date for a ScheduleEvent, normalising all-day events
 * (which carry a date-only string) to midnight UTC.
 */
function getEventDate(event: ScheduleEvent): Date | null {
  if (event.isAllDay && event.startDate) {
    return new Date(`${event.startDate}T00:00:00Z`);
  }
  return event.startUtc;
}

function sortEvents(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => {
    const aTime = getEventDate(a)?.getTime() ?? 0;
    const bTime = getEventDate(b)?.getTime() ?? 0;
    return aTime - bTime;
  });
}

export class SchedulePollService {
  // In-memory cache: "${guildId}:${channelId}" → events
  private readonly cache = new Map<string, ScheduleEvent[]>();
  private readonly inProgressChannels = new Set<string>();
  private readonly httpSemaphore = new Semaphore(10);
  private readonly discordSemaphore = new Semaphore(5);

  constructor(
    private readonly repo: ScheduleChannelRepository,
    private readonly calendarClient: GoogleCalendarClient,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  private cacheKey(channel: ScheduleChannel): string {
    return `${channel.guildId}:${channel.channelId}`;
  }

  clearCache(channel: ScheduleChannel): void {
    this.cache.delete(this.cacheKey(channel));
  }

  applyDiff(channel: ScheduleChannel, changedItems: CalendarEventItem[]): void {
    const key = this.cacheKey(channel);
    const existing = this.cache.get(key) ?? [];
    const eventMap = new Map(existing.map((e) => [e.id, e]));

    for (const item of changedItems) {
      if (item.status === "cancelled") {
        eventMap.delete(item.id);
      } else {
        eventMap.set(item.id, mapCalendarItemToEvent(item));
      }
    }

    this.cache.set(key, sortEvents(Array.from(eventMap.values())));
  }

  async pollAll(): Promise<void> {
    const now = new Date();
    const dueChannels = await this.repo.findAllDue(now);

    if (dueChannels.length === 0) return;

    this.logger.debug({ count: dueChannels.length }, "Polling schedule channels");

    await Promise.allSettled(
      dueChannels.map((channel) =>
        this.httpSemaphore.run(async () => {
          const key = `${channel.guildId}:${channel.channelId}`;
          if (this.inProgressChannels.has(key)) return;
          this.inProgressChannels.add(key);
          try {
            await this.pollChannel(channel);
          } catch (err) {
            this.logger.error(
              {
                err,
                guildId: channel.guildId.toString(),
                channelId: channel.channelId.toString(),
              },
              "Unexpected error polling schedule channel",
            );
          } finally {
            this.inProgressChannels.delete(key);
          }
        }),
      ),
    );
  }

  async pollChannel(channel: ScheduleChannel): Promise<void> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    const key = this.cacheKey(channel);

    // Snapshot previous events before any cache mutation
    const previousEvents = new Map(
      (this.cache.get(key) ?? []).map((e) => [e.id, e]),
    );

    // Archive check: detect messages from previous month that aren't archived yet
    const prevMonthYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevMessages = await this.repo.getMessages(
      channel.guildId,
      channel.channelId,
      prevMonthYear,
      prevMonth,
    );
    const unarchivedPrev = prevMessages.filter((m) => !m.isArchived);

    if (unarchivedPrev.length > 0) {
      await this.archivePreviousMonth(channel, prevMonthYear, prevMonth, unarchivedPrev, now);
    }

    // Fetch events
    const cacheEmpty = !this.cache.has(key);
    const wasFullFetch = cacheEmpty || !channel.syncToken;
    let changedItems: CalendarEventItem[];
    let newSyncToken: string | undefined;

    try {
      if (cacheEmpty) {
        // Full fetch
        const result = await this.fullFetch(channel, year, month);
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
      } else if (channel.syncToken) {
        // Incremental fetch
        const result = await this.calendarClient.listEvents(channel.calendarId, {
          syncToken: channel.syncToken,
        });
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
        this.applyDiff(channel, changedItems);
        // Trim cache to current month only
        const cached = this.cache.get(key) ?? [];
        this.cache.set(key, cached.filter((e) => {
          const d = getEventDate(e);
          return d ? isSameMonth(d, year, month) : false;
        }));
      } else {
        // No sync token — full fetch
        const result = await this.fullFetch(channel, year, month);
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
      }
    } catch (err) {
      if (err instanceof GoogleCalendarError) {
        if (err.statusCode === 410) {
          // Sync token expired — clear and do a full fetch
          this.logger.warn(
            { guildId: channel.guildId.toString(), calendarId: channel.calendarId },
            "Sync token expired (410), performing full fetch",
          );
          await this.repo.updateSyncToken(
            channel.guildId,
            channel.channelId,
            null,
            computeNextPollAt(channel.pollIntervalSec),
          );
          this.cache.delete(key);
          return; // Will refetch next tick
        }

        if (err.statusCode === 403 || err.statusCode === 404) {
          const nextPollAt = computeBackoffNextPollAt(
            channel.pollIntervalSec,
            channel.consecutiveFailures,
          );
          await this.repo.recordFailure(
            channel.guildId,
            channel.channelId,
            err.message,
            nextPollAt,
          );
          await this.sendPermanentErrorAlert(channel, err.statusCode, err.message);
          return;
        }
      }

      // Transient error
      const nextPollAt = computeBackoffNextPollAt(
        channel.pollIntervalSec,
        channel.consecutiveFailures,
      );
      const reason = err instanceof Error ? err.message : String(err);
      await this.repo.recordFailure(
        channel.guildId,
        channel.channelId,
        reason,
        nextPollAt,
      );
      this.logger.warn(
        { err, guildId: channel.guildId.toString(), channelId: channel.channelId.toString() },
        "Transient error polling schedule channel, backing off",
      );
      return;
    }

    // Recovery notification if previous failures
    const nextPollAt = computeNextPollAt(channel.pollIntervalSec);
    if (channel.consecutiveFailures > 0) {
      await this.sendRecoveryNotification(channel);
      await this.repo.resetFailures(
        channel.guildId,
        channel.channelId,
        nextPollAt,
      );
      await this.repo.updateSyncToken(
        channel.guildId,
        channel.channelId,
        newSyncToken ?? null,
        nextPollAt,
      );
    } else {
      await this.repo.updateSyncToken(
        channel.guildId,
        channel.channelId,
        newSyncToken ?? null,
        nextPollAt,
      );
    }

    // Log channel notifications for changed events in current month
    const currentMonthChanges = changedItems.filter((item) => {
      const startStr = item.start?.dateTime ?? item.start?.date;
      if (!startStr) {
        // Cancelled items may omit start — check if it was in this month's cache
        // (also verify by date in case the snapshot includes cross-month events)
        const prevEvent = previousEvents.get(item.id);
        if (!prevEvent) return false;
        const prevDate = getEventDate(prevEvent);
        return prevDate ? isSameMonth(prevDate, year, month) : false;
      }
      const d = new Date(startStr);
      return isSameMonth(d, year, month);
    });

    // Only send notifications for incremental changes, not full fetches.
    // Full fetches would spuriously report every event as "added".
    if (!wasFullFetch && currentMonthChanges.length > 0) {
      await this.sendEventChangeNotifications(channel, currentMonthChanges, previousEvents);
    }

    // Re-render current month and sync Discord messages.
    // fullFetch already bounds the cache to the current month's UTC window, so
    // the isSameMonth filter below is a no-op for the full-fetch case.  It
    // exists primarily to drop events that arrive via incremental sync from
    // outside the current month window (e.g. a recurring event that started
    // last month).
    const events = this.cache.get(key) ?? [];
    const currentMonthEvents = events.filter((e) => {
      const d = getEventDate(e);
      return d ? isSameMonth(d, year, month) : false;
    });

    const chunks = renderSchedule(currentMonthEvents, "live", channel.displayTitle, year, month, now);
    await this.syncDiscordMessages(channel, year, month, chunks);
  }

  private async fullFetch(
    channel: ScheduleChannel,
    year: number,
    month: number,
  ): Promise<{ items: CalendarEventItem[]; nextSyncToken?: string }> {
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const endOfMonth = new Date(Date.UTC(year, month, 1)).toISOString();
    const result = await this.calendarClient.listEvents(channel.calendarId, {
      timeMin: startOfMonth,
      timeMax: endOfMonth,
    });
    this.cache.set(
      this.cacheKey(channel),
      sortEvents(
        result.items
          .filter((i) => i.status !== "cancelled")
          .map(mapCalendarItemToEvent),
      ),
    );
    return result;
  }

  private async archivePreviousMonth(
    channel: ScheduleChannel,
    year: number,
    month: number,
    unarchivedMessages: ScheduleChannelMessage[],
    now: Date,
  ): Promise<void> {
    // Fetch previous month events from Google Calendar directly
    const startOfPrevMonth = new Date(Date.UTC(year, month - 1, 1)).toISOString();
    const endOfPrevMonth = new Date(Date.UTC(year, month, 1)).toISOString();

    let prevEvents: ScheduleEvent[] = [];
    try {
      const result = await this.calendarClient.listEvents(channel.calendarId, {
        timeMin: startOfPrevMonth,
        timeMax: endOfPrevMonth,
      });
      prevEvents = sortEvents(
        result.items
          .filter((i) => i.status !== "cancelled")
          .map(mapCalendarItemToEvent),
      );
    } catch (err) {
      this.logger.warn(
        { err, guildId: channel.guildId.toString(), channelId: channel.channelId.toString() },
        "Failed to fetch previous month events for archiving, skipping archive render",
      );
      await this.repo.markArchived(channel.guildId, channel.channelId, year, month);
      return;
    }

    const archiveChunks = renderSchedule(prevEvents, "archive", channel.displayTitle, year, month, now);

    const discordChannel = await this.fetchTextChannel(channel.channelId.toString(), "archivePreviousMonth");

    // Sync each archive chunk: edit existing messages, post new ones where missing
    for (let i = 0; i < archiveChunks.length; i++) {
      const chunk = archiveChunks[i];
      const existing = unarchivedMessages.find((m) => m.messageIndex === i);

      await this.discordSemaphore.run(async () => {
        if (existing) {
          if (!discordChannel) return;
          try {
            const discordMsg = await discordChannel.messages.fetch(existing.messageId.toString());
            await discordMsg.edit({
              components: [chunk.container],
              flags: MessageFlags.IsComponentsV2,
            });
            await this.repo.upsertMessage(
              channel.guildId,
              channel.channelId,
              year,
              month,
              i,
              existing.messageId,
              chunk.hash,
            );
          } catch (err) {
            this.logger.warn(
              { err, messageId: existing.messageId.toString() },
              "Failed to edit archived message",
            );
          }
        } else {
          // No existing DB message for this chunk — post a new one
          if (!discordChannel) return;
          try {
            const newMsg = await discordChannel.send({
              components: [chunk.container],
              flags: MessageFlags.IsComponentsV2,
            });
            await this.repo.upsertMessage(
              channel.guildId,
              channel.channelId,
              year,
              month,
              i,
              BigInt(newMsg.id),
              chunk.hash,
            );
          } catch (err) {
            this.logger.warn(
              { err, chunkIndex: i },
              "Failed to post new archive message",
            );
          }
        }
      });
    }

    // Delete Discord messages and DB rows for indices beyond archiveChunks.length
    const excessMessages = unarchivedMessages.filter(
      (m) => m.messageIndex >= archiveChunks.length,
    );
    for (const msg of excessMessages) {
      await this.discordSemaphore.run(async () => {
        if (!discordChannel) return;
        try {
          const discordMsg = await discordChannel.messages.fetch(msg.messageId.toString());
          await discordMsg.delete();
        } catch (err) {
          if (!isDiscordUnknownMessageError(err)) {
            this.logger.warn(
              { err, messageId: msg.messageId.toString() },
              "Failed to delete excess archive message",
            );
          }
        }
      });
    }
    if (excessMessages.length > 0) {
      await this.repo.deleteMessagesAboveIndex(
        channel.guildId,
        channel.channelId,
        year,
        month,
        archiveChunks.length - 1,
      );
    }

    await this.repo.markArchived(channel.guildId, channel.channelId, year, month);
  }

  private async sendEventChangeNotifications(
    channel: ScheduleChannel,
    changedItems: CalendarEventItem[],
    previousEvents: Map<string, ScheduleEvent>,
  ): Promise<void> {
    const lines: string[] = [];

    for (const item of changedItems) {
      const event = mapCalendarItemToEvent(item);
      const timePart = event.isAllDay && event.startDate
        ? `<t:${Math.floor(new Date(`${event.startDate}T00:00:00Z`).getTime() / 1000)}:D>`
        : event.startUtc
        ? `<t:${Math.floor(event.startUtc.getTime() / 1000)}:f>`
        : "";

      const label = timePart ? `${timePart} ${event.summary}` : event.summary;

      const wasInCache = previousEvents.has(item.id);

      if (item.status === "cancelled") {
        const prevEvent = previousEvents.get(item.id);
        const prevTimePart = prevEvent?.isAllDay && prevEvent?.startDate
          ? `<t:${Math.floor(new Date(`${prevEvent.startDate}T00:00:00Z`).getTime() / 1000)}:D>`
          : prevEvent?.startUtc
          ? `<t:${Math.floor(prevEvent.startUtc.getTime() / 1000)}:f>`
          : "";
        const prevSummary = prevEvent?.summary ?? event.summary;
        const cancelLabel = prevTimePart ? `${prevTimePart} ${prevSummary}` : prevSummary;
        // TODO: use emojis.trash once emoji service is available in SchedulePollService
        lines.push(`🗑️ Event removed: ${cancelLabel}`);
        continue; // skip the rest of the loop body
      } else if (wasInCache) {
        lines.push(`✏️ Event updated: ${label}`);
      } else {
        lines.push(`✅ Event added: ${label}`);
      }
    }

    if (lines.length === 0) return;

    const logChannel = await this.fetchTextChannel(channel.logChannelId.toString(), "sendEventChangeNotifications");
    if (!logChannel) return;

    const raw = lines.join("\n");
    const content = raw.length > 4000 ? raw.slice(0, 4000) + "\n…(truncated)" : raw;

    const container = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(content)
      );

    try {
      await logChannel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: channel.logChannelId.toString() },
        "Failed to send event change notifications to log channel",
      );
    }
  }

  private async sendPermanentErrorAlert(
    channel: ScheduleChannel,
    statusCode: number,
    reason: string,
  ): Promise<void> {
    // Rate limit: don't post if we already posted in the last 24h
    if (
      channel.lastErrorAt &&
      Date.now() - channel.lastErrorAt.getTime() < ALERT_RATE_LIMIT_MS
    ) {
      return;
    }

    const message =
      statusCode === 403
        ? `⚠️ <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> is no longer accessible (permission denied). Please ensure the calendar is set to public.`
        : `⚠️ <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> was not found (404). The calendar may have been deleted or the ID is invalid.`;

    const logChannel = await this.fetchTextChannel(channel.logChannelId.toString(), "sendPermanentErrorAlert");
    if (!logChannel) return;

    const alertContainer = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(message)
      );

    try {
      await logChannel.send({
        components: [alertContainer],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: channel.logChannelId.toString() },
        "Failed to send error alert to log channel",
      );
    }
  }

  private async sendRecoveryNotification(channel: ScheduleChannel): Promise<void> {
    const logChannel = await this.fetchTextChannel(channel.logChannelId.toString(), "sendRecoveryNotification");
    if (!logChannel) return;

    const recoveryContainer = new ContainerBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `✅ Schedule sync for <#${channel.channelId}> has recovered and is now working again.`
        )
      );

    try {
      await logChannel.send({
        components: [recoveryContainer],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: channel.logChannelId.toString() },
        "Failed to send recovery notification to log channel",
      );
    }
  }

  private async fetchTextChannel(channelId: string, context: string): Promise<GuildTextBasedChannel | null> {
    try {
      const ch = await this.client.channels.fetch(channelId);
      if (!ch?.isTextBased() || ch.isDMBased()) {
        this.logger.warn({ channelId, context }, "Channel is not a guild text channel");
        return null;
      }
      return ch as GuildTextBasedChannel;
    } catch (err) {
      this.logger.warn({ err, channelId, context }, "Failed to fetch channel");
      return null;
    }
  }

  private async syncDiscordMessages(
    channel: ScheduleChannel,
    year: number,
    month: number,
    chunks: ReturnType<typeof renderSchedule>,
  ): Promise<void> {
    const existingMessages = await this.repo.getMessages(
      channel.guildId,
      channel.channelId,
      year,
      month,
    );

    const discordChannel = await this.fetchTextChannel(
      channel.channelId.toString(), "syncDiscordMessages",
    );

    if (!discordChannel) return;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const existing = existingMessages.find((m) => m.messageIndex === i);

      await this.discordSemaphore.run(async () => {
        if (existing) {
          if (existing.contentHash === chunk.hash) return; // No change

          try {
            const msg = await discordChannel.messages.fetch(existing.messageId.toString());
            await msg.edit({
              components: [chunk.container],
              flags: MessageFlags.IsComponentsV2,
            });
            await this.repo.upsertMessage(
              channel.guildId,
              channel.channelId,
              year,
              month,
              i,
              existing.messageId,
              chunk.hash,
            );
          } catch (err: unknown) {
            // 10008 = Unknown Message — repost as new
            if (isDiscordUnknownMessageError(err)) {
              const newMsg = await discordChannel.send({
                components: [chunk.container],
                flags: MessageFlags.IsComponentsV2,
              });
              await this.repo.upsertMessage(
                channel.guildId,
                channel.channelId,
                year,
                month,
                i,
                BigInt(newMsg.id),
                chunk.hash,
              );
            } else {
              throw err;
            }
          }
        } else {
          // Post new message
          const newMsg = await discordChannel.send({
            components: [chunk.container],
            flags: MessageFlags.IsComponentsV2,
          });
          await this.repo.upsertMessage(
            channel.guildId,
            channel.channelId,
            year,
            month,
            i,
            BigInt(newMsg.id),
            chunk.hash,
          );
        }
      });
    }

    // Delete excess messages
    const excessMessages = existingMessages.filter(
      (m) => m.messageIndex >= chunks.length,
    );
    for (const msg of excessMessages) {
      await this.discordSemaphore.run(async () => {
        try {
          const discordMsg = await discordChannel.messages.fetch(msg.messageId.toString());
          await discordMsg.delete();
        } catch (err) {
          if (!isDiscordUnknownMessageError(err)) {
            this.logger.warn(
              { err, messageId: msg.messageId.toString() },
              "Failed to delete excess schedule message",
            );
          }
        }
      });
    }

    // Remove excess DB rows
    if (excessMessages.length > 0) {
      await this.repo.deleteMessagesAboveIndex(
        channel.guildId,
        channel.channelId,
        year,
        month,
        chunks.length - 1,
      );
    }
  }
}

function isDiscordUnknownMessageError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: number }).code === 10008
  );
}
