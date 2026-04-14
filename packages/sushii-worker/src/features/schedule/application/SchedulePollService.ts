import type { Logger } from "pino";

import { Semaphore } from "@/shared/infrastructure/concurrency/Semaphore";
import type { ScheduleChannel } from "../domain/entities/ScheduleChannel";
import type { ScheduleChannelMessage } from "../domain/entities/ScheduleChannelMessage";
import type { ScheduleChannelRepository } from "../domain/repositories/ScheduleChannelRepository";
import type { ScheduleMessageRepository } from "../domain/repositories/ScheduleMessageRepository";
import { renderSchedule } from "../domain/services/ScheduleRenderService";
import { GoogleCalendarError } from "../infrastructure/google/GoogleCalendarClient";
import { calendarItemIssues } from "../domain/value-objects/CalendarEventIssue";
import type { CalendarSyncService } from "./CalendarSyncService";
import type { DiscordSchedulePublisher } from "./DiscordSchedulePublisher";

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

export class SchedulePollService {
  private readonly inProgressChannels = new Set<string>();
  private readonly httpSemaphore = new Semaphore(10);

  constructor(
    private readonly channelRepo: ScheduleChannelRepository,
    private readonly messageRepo: ScheduleMessageRepository,
    private readonly calendarSync: CalendarSyncService,
    private readonly discordPublisher: DiscordSchedulePublisher,
    private readonly logger: Logger,
  ) {}

  /** Delegates to CalendarSyncService — preserves ScheduleChannelService compatibility. */
  clearCache(channel: ScheduleChannel): void {
    this.calendarSync.clearCache(channel);
  }

  async pollAll(): Promise<void> {
    const now = new Date();
    const dueChannels = await this.channelRepo.findAllDue(now);

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

    // Snapshot previous events before any cache mutation
    const previousEvents = new Map(
      this.calendarSync.getCachedEvents(channel).map((e) => [e.id, e]),
    );

    // Archive check: detect messages from previous month that aren't archived yet
    const prevMonthYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevMessages = await this.messageRepo.getMessages(
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
    const cacheEmpty = !this.calendarSync.hasCached(channel);
    const wasFullFetch = cacheEmpty || !channel.syncToken;
    let changedItems;
    let newSyncToken: string | undefined;

    try {
      if (wasFullFetch) {
        // Full fetch
        const result = await this.calendarSync.fullFetch(channel, year, month);
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
      } else {
        // Incremental fetch
        const result = await this.calendarSync.incrementalFetch(channel, year, month);
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
      }
    } catch (err) {
      if (err instanceof GoogleCalendarError) {
        if (err.statusCode === 410) {
          // Sync token expired — clear and do a full fetch next tick
          this.logger.warn(
            { guildId: channel.guildId.toString(), calendarId: channel.calendarId },
            "Sync token expired (410), performing full fetch",
          );
          await this.channelRepo.updateSyncToken(
            channel.guildId,
            channel.channelId,
            null,
            computeNextPollAt(channel.pollIntervalSec),
          );
          this.calendarSync.clearCache(channel);
          return;
        }

        if (err.statusCode === 403 || err.statusCode === 404) {
          const nextPollAt = computeBackoffNextPollAt(
            channel.pollIntervalSec,
            channel.consecutiveFailures,
          );
          await this.channelRepo.recordFailure(
            channel.guildId,
            channel.channelId,
            err.message,
            nextPollAt,
          );
          await this.discordPublisher.sendPermanentErrorAlert(channel, err.statusCode, err.message);
          return;
        }
      }

      // Transient error
      const nextPollAt = computeBackoffNextPollAt(
        channel.pollIntervalSec,
        channel.consecutiveFailures,
      );
      const reason = err instanceof Error ? err.message : String(err);
      await this.channelRepo.recordFailure(
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
      await this.discordPublisher.sendRecoveryNotification(channel);
      await this.channelRepo.resetFailuresAndUpdateToken(
        channel.guildId,
        channel.channelId,
        newSyncToken ?? null,
        nextPollAt,
      );
    } else {
      await this.channelRepo.updateSyncToken(
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
        const prevEvent = previousEvents.get(item.id);
        if (!prevEvent) return false;
        const prevDate = prevEvent.getDate();
        return prevDate ? isSameMonth(prevDate, year, month) : false;
      }
      const d = new Date(startStr);
      return isSameMonth(d, year, month);
    });

    // On full fetch, alert about any problematic events in the current month.
    if (wasFullFetch) {
      const problemItems = changedItems.filter(
        (item) => item.status !== "cancelled" && calendarItemIssues(item).length > 0,
      );
      if (problemItems.length > 0) {
        await this.discordPublisher.sendEventIssuesAlert(channel, problemItems);
      }
    }

    // Only send notifications for incremental changes, not full fetches.
    // Full fetches would spuriously report every event as "added".
    if (!wasFullFetch && currentMonthChanges.length > 0) {
      await this.discordPublisher.sendEventChangeNotifications(
        channel,
        currentMonthChanges,
        previousEvents,
      );
    }

    // Re-render current month and sync Discord messages.
    // fullFetch already bounds the cache to the current month's UTC window, so
    // the isSameMonth filter below is a no-op for the full-fetch case. It
    // exists primarily to drop events that arrive via incremental sync from
    // outside the current month window (e.g. a recurring event that started
    // last month).
    const events = this.calendarSync.getCachedEvents(channel);
    const currentMonthEvents = events.filter((e) => {
      const d = e.getDate();
      return d ? isSameMonth(d, year, month) : false;
    });

    const chunks = renderSchedule(currentMonthEvents, "live", channel.displayTitle, year, month, now);
    await this.discordPublisher.syncMessages(channel, year, month, chunks);
  }

  private async archivePreviousMonth(
    channel: ScheduleChannel,
    year: number,
    month: number,
    unarchivedMessages: ScheduleChannelMessage[],
    now: Date,
  ): Promise<void> {
    let prevEvents;
    try {
      prevEvents = await this.calendarSync.fetchMonthEvents(channel.calendarId, year, month);
    } catch (err) {
      this.logger.warn(
        { err, guildId: channel.guildId.toString(), channelId: channel.channelId.toString() },
        "Failed to fetch previous month events for archiving, skipping archive render",
      );
      await this.messageRepo.markArchived(channel.guildId, channel.channelId, year, month);
      return;
    }

    const archiveChunks = renderSchedule(
      prevEvents,
      "archive",
      channel.displayTitle,
      year,
      month,
      now,
    );
    await this.discordPublisher.archiveMonth(channel, year, month, unarchivedMessages, archiveChunks);
  }
}
