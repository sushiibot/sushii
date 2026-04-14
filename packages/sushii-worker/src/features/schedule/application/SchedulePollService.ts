import type { Logger } from "pino";

import { Semaphore } from "@/shared/infrastructure/concurrency/Semaphore";
import type { Schedule } from "../domain/entities/Schedule";
import type { ScheduleMessage } from "../domain/entities/ScheduleMessage";
import type { ScheduleRepository } from "../domain/repositories/ScheduleRepository";
import type { ScheduleMessageRepository } from "../domain/repositories/ScheduleMessageRepository";
import type { ScheduleEventRepository } from "../domain/repositories/ScheduleEventRepository";
import { renderSchedule } from "@/features/schedule/presentation/views/ScheduleMessageBuilder";
import {
  GoogleCalendarError,
  type CalendarEventItem,
} from "../infrastructure/google/GoogleCalendarClient";
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
  private readonly inProgressSchedules = new Set<string>();
  // Limit concurrent Google Calendar HTTP requests
  private readonly httpSemaphore = new Semaphore(10);

  constructor(
    private readonly scheduleRepo: ScheduleRepository,
    private readonly messageRepo: ScheduleMessageRepository,
    private readonly eventRepo: ScheduleEventRepository,
    private readonly calendarSync: CalendarSyncService,
    private readonly discordPublisher: DiscordSchedulePublisher,
    private readonly logger: Logger,
  ) {}

  async pollAll(): Promise<void> {
    const now = new Date();
    const dueSchedules = await this.scheduleRepo.findAllDue(now);

    if (dueSchedules.length === 0) return;

    this.logger.debug({ count: dueSchedules.length }, "Polling schedule channels");

    await Promise.allSettled(
      dueSchedules.map((schedule) =>
        this.httpSemaphore.run(async () => {
          const key = `${schedule.guildId}:${schedule.calendarId}`;
          if (this.inProgressSchedules.has(key)) return;
          this.inProgressSchedules.add(key);
          try {
            await this.pollSchedule(schedule);
          } catch (err) {
            this.logger.error(
              {
                err,
                guildId: schedule.guildId.toString(),
                calendarId: schedule.calendarId,
              },
              "Unexpected error polling schedule",
            );
          } finally {
            this.inProgressSchedules.delete(key);
          }
        }),
      ),
    );
  }

  async pollSchedule(schedule: Schedule): Promise<void> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

    // Snapshot previous events before any DB mutation (for change detection)
    const previousEvents = await this.calendarSync.getPreviousEvents(
      schedule.guildId,
      schedule.calendarId,
      year,
      month,
    );

    // Archive check: detect messages from previous month that aren't archived yet
    const prevMonthYear = month === 1 ? year - 1 : year;
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevMessages = await this.messageRepo.getMessages(
      schedule.guildId,
      schedule.calendarId,
      prevMonthYear,
      prevMonth,
    );
    const unarchivedPrev = prevMessages.filter((m) => !m.isArchived);

    if (unarchivedPrev.length > 0) {
      await this.archivePreviousMonth(schedule, prevMonthYear, prevMonth, unarchivedPrev, now);
    }

    // Fetch events
    const wasFullFetch = !schedule.syncToken;
    let changedItems: CalendarEventItem[];
    let newSyncToken: string | undefined;

    try {
      if (wasFullFetch) {
        const result = await this.calendarSync.fullFetch(schedule, year, month);
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
      } else {
        const result = await this.calendarSync.incrementalFetch(schedule, schedule.syncToken!);
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
      }
    } catch (err) {
      if (err instanceof GoogleCalendarError) {
        if (err.statusCode === 410) {
          this.logger.warn(
            { guildId: schedule.guildId.toString(), calendarId: schedule.calendarId },
            "Sync token expired (410), performing full fetch",
          );
          await this.scheduleRepo.updateSyncToken(
            schedule.guildId,
            schedule.calendarId,
            null,
            computeNextPollAt(schedule.pollIntervalSec),
          );
          return;
        }

        if (err.statusCode === 403 || err.statusCode === 404) {
          const nextPollAt = computeBackoffNextPollAt(
            schedule.pollIntervalSec,
            schedule.consecutiveFailures,
          );
          await this.scheduleRepo.recordFailure(
            schedule.guildId,
            schedule.calendarId,
            err.message,
            nextPollAt,
          );
          await this.discordPublisher.sendPermanentErrorAlert(schedule, err.statusCode, err.message);
          return;
        }
      }

      const nextPollAt = computeBackoffNextPollAt(
        schedule.pollIntervalSec,
        schedule.consecutiveFailures,
      );
      const reason = err instanceof Error ? err.message : String(err);
      await this.scheduleRepo.recordFailure(
        schedule.guildId,
        schedule.calendarId,
        reason,
        nextPollAt,
      );
      this.logger.warn(
        { err, guildId: schedule.guildId.toString(), calendarId: schedule.calendarId },
        "Transient error polling schedule, backing off",
      );
      return;
    }

    // Update sync token / reset failures
    const nextPollAt = computeNextPollAt(schedule.pollIntervalSec);
    if (schedule.consecutiveFailures > 0) {
      await this.discordPublisher.sendRecoveryNotification(schedule);
      await this.scheduleRepo.resetFailuresAndUpdateToken(
        schedule.guildId,
        schedule.calendarId,
        newSyncToken ?? null,
        nextPollAt,
      );
    } else {
      await this.scheduleRepo.updateSyncToken(
        schedule.guildId,
        schedule.calendarId,
        newSyncToken ?? null,
        nextPollAt,
      );
    }

    // Filter changed items to current month for notifications
    const currentMonthChanges = changedItems.filter((item) => {
      const startStr = item.start?.dateTime ?? item.start?.date;
      if (!startStr) {
        const prevEvent = previousEvents.get(item.id);
        if (!prevEvent) return false;
        const prevDate = prevEvent.getDate();
        return prevDate ? isSameMonth(prevDate, year, month) : false;
      }
      const d = new Date(startStr);
      return isSameMonth(d, year, month);
    });

    // On full fetch, alert about any problematic events in the current month
    if (wasFullFetch) {
      const problemItems = changedItems.filter(
        (item) => item.status !== "cancelled" && calendarItemIssues(item) !== null,
      );
      if (problemItems.length > 0) {
        await this.discordPublisher.sendEventIssuesAlert(schedule, problemItems);
      }
    }

    // Only send change notifications for incremental syncs
    if (!wasFullFetch && currentMonthChanges.length > 0) {
      await this.discordPublisher.sendEventChangeNotifications(
        schedule,
        currentMonthChanges,
        previousEvents,
      );
    }

    // Re-render current month and sync Discord messages
    const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
    const endOfMonth = new Date(Date.UTC(year, month, 1));
    const currentMonthEvents = await this.eventRepo.findEventsByCalendar(
      schedule.guildId,
      schedule.calendarId,
      startOfMonth,
      endOfMonth,
    );

    const chunks = renderSchedule(
      currentMonthEvents,
      "live",
      schedule.displayTitle,
      year,
      month,
      now,
    );
    await this.discordPublisher.syncMessages(schedule, year, month, chunks);
  }

  private async archivePreviousMonth(
    schedule: Schedule,
    year: number,
    month: number,
    unarchivedMessages: ScheduleMessage[],
    now: Date,
  ): Promise<void> {
    let prevEvents;
    try {
      prevEvents = await this.calendarSync.fetchMonthEvents(schedule.calendarId, year, month);
    } catch (err) {
      this.logger.warn(
        { err, guildId: schedule.guildId.toString(), calendarId: schedule.calendarId },
        "Failed to fetch previous month events for archiving, skipping archive render",
      );
      await this.messageRepo.markArchived(schedule.guildId, schedule.calendarId, year, month);
      return;
    }

    const archiveChunks = renderSchedule(
      prevEvents,
      "archive",
      schedule.displayTitle,
      year,
      month,
      now,
    );
    await this.discordPublisher.archiveMonth(schedule, year, month, unarchivedMessages, archiveChunks);
  }
}
