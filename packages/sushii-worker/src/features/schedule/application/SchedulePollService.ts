import type { Client, TextChannel } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Logger } from "pino";

import type { ScheduleChannel } from "../domain/entities/ScheduleChannel";
import type { ScheduleEvent } from "../domain/entities/ScheduleEvent";
import type { ScheduleChannelRepository } from "../domain/repositories/ScheduleChannelRepository";
import { renderSchedule } from "../domain/services/ScheduleRenderService";
import type {
  GoogleCalendarClient,
  CalendarEventItem,
} from "../infrastructure/google/GoogleCalendarClient";
import { GoogleCalendarError } from "../infrastructure/google/GoogleCalendarClient";

const ALERT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours

class Semaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

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
  const backoffSec = Math.min(
    intervalSec * Math.pow(2, consecutiveFailures),
    3600,
  );
  return new Date(Date.now() + backoffSec * 1000);
}

function isSameMonth(date: Date, year: number, month: number): boolean {
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month;
}

export class SchedulePollService {
  // In-memory cache: calendarId → events
  private readonly cache = new Map<string, ScheduleEvent[]>();
  private readonly httpSemaphore = new Semaphore(10);
  private readonly discordSemaphore = new Semaphore(5);

  constructor(
    private readonly repo: ScheduleChannelRepository,
    private readonly calendarClient: GoogleCalendarClient,
    private readonly client: Client,
    private readonly logger: Logger,
  ) {}

  applyDiff(calendarId: string, changedItems: CalendarEventItem[]): void {
    const existing = this.cache.get(calendarId) ?? [];
    const eventMap = new Map(existing.map((e) => [e.id, e]));

    for (const item of changedItems) {
      if (item.status === "cancelled") {
        eventMap.delete(item.id);
      } else {
        eventMap.set(item.id, mapCalendarItemToEvent(item));
      }
    }

    this.cache.set(calendarId, Array.from(eventMap.values()));
  }

  async pollAll(): Promise<void> {
    const now = new Date();
    const dueChannels = await this.repo.findAllDue(now);

    if (dueChannels.length === 0) return;

    this.logger.debug({ count: dueChannels.length }, "Polling schedule channels");

    await Promise.allSettled(
      dueChannels.map((channel) =>
        this.httpSemaphore.run(() =>
          this.pollChannel(channel).catch((err) => {
            this.logger.error(
              {
                err,
                guildId: channel.guildId.toString(),
                channelId: channel.channelId.toString(),
              },
              "Unexpected error polling schedule channel",
            );
          }),
        ),
      ),
    );
  }

  async pollChannel(channel: ScheduleChannel): Promise<void> {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth() + 1;

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
      await this.archivePreviousMonth(channel, prevMonthYear, prevMonth, unarchivedPrev);
    }

    // Fetch events
    const cacheEmpty = !this.cache.has(channel.calendarId);
    let changedItems: CalendarEventItem[];
    let newSyncToken: string | undefined;

    try {
      if (cacheEmpty) {
        // Full fetch
        const startOfMonth = new Date(Date.UTC(year, month - 1, 1)).toISOString();
        const endOfMonth = new Date(Date.UTC(year, month, 1)).toISOString();
        const result = await this.calendarClient.listEvents(channel.calendarId, {
          timeMin: startOfMonth,
          timeMax: endOfMonth,
        });
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
        // Initialize cache with full result
        this.cache.set(
          channel.calendarId,
          changedItems.filter((i) => i.status !== "cancelled").map(mapCalendarItemToEvent),
        );
      } else if (channel.syncToken) {
        // Incremental fetch
        const result = await this.calendarClient.listEvents(channel.calendarId, {
          syncToken: channel.syncToken,
        });
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
        this.applyDiff(channel.calendarId, changedItems);
      } else {
        // No sync token — full fetch
        const startOfMonth = new Date(Date.UTC(year, month - 1, 1)).toISOString();
        const endOfMonth = new Date(Date.UTC(year, month, 1)).toISOString();
        const result = await this.calendarClient.listEvents(channel.calendarId, {
          timeMin: startOfMonth,
          timeMax: endOfMonth,
        });
        changedItems = result.items;
        newSyncToken = result.nextSyncToken;
        this.cache.set(
          channel.calendarId,
          changedItems.filter((i) => i.status !== "cancelled").map(mapCalendarItemToEvent),
        );
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
          this.cache.delete(channel.calendarId);
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
    if (channel.consecutiveFailures > 0) {
      await this.sendRecoveryNotification(channel);
      await this.repo.resetFailures(
        channel.guildId,
        channel.channelId,
        computeNextPollAt(channel.pollIntervalSec),
      );
    } else {
      await this.repo.updateSyncToken(
        channel.guildId,
        channel.channelId,
        newSyncToken ?? null,
        computeNextPollAt(channel.pollIntervalSec),
      );
    }

    // Log channel notifications for changed events in current month
    const currentMonthChanges = changedItems.filter((item) => {
      const startStr = item.start?.dateTime ?? item.start?.date;
      if (!startStr) return false;
      const d = new Date(startStr);
      return isSameMonth(d, year, month);
    });

    if (currentMonthChanges.length > 0) {
      await this.sendEventChangeNotifications(channel, currentMonthChanges);
    }

    // Re-render current month and sync Discord messages
    const events = this.cache.get(channel.calendarId) ?? [];
    const currentMonthEvents = events.filter((e) => {
      const d = e.isAllDay && e.startDate
        ? new Date(`${e.startDate}T00:00:00Z`)
        : e.startUtc;
      return d ? isSameMonth(d, year, month) : false;
    });

    const chunks = renderSchedule(currentMonthEvents, "live", channel.calendarTitle || "Schedule", now);
    await this.syncDiscordMessages(channel, year, month, chunks);
  }

  private async archivePreviousMonth(
    channel: ScheduleChannel,
    year: number,
    month: number,
    unarchivedMessages: Array<{ messageIndex: number; messageId: bigint; contentHash: string; isArchived: boolean; guildId: bigint; channelId: bigint; year: number; month: number; lastUpdatedAt: Date }>,
  ): Promise<void> {
    const cachedEvents = this.cache.get(channel.calendarId) ?? [];
    const prevEvents = cachedEvents.filter((e) => {
      const d = e.isAllDay && e.startDate
        ? new Date(`${e.startDate}T00:00:00Z`)
        : e.startUtc;
      return d ? isSameMonth(d, year, month) : false;
    });

    const now = new Date();
    const archiveChunks = renderSchedule(prevEvents, "archive", channel.calendarTitle || "Schedule", now);

    for (const msg of unarchivedMessages) {
      const chunk = archiveChunks[msg.messageIndex];
      if (!chunk) continue;

      await this.discordSemaphore.run(async () => {
        try {
          const discordChannel = await this.client.channels.fetch(channel.channelId.toString()) as TextChannel;
          const discordMsg = await discordChannel.messages.fetch(msg.messageId.toString());
          await discordMsg.edit({
            components: [chunk.container],
            flags: MessageFlags.IsComponentsV2,
          });
        } catch (err) {
          this.logger.warn(
            { err, messageId: msg.messageId.toString() },
            "Failed to edit archived message",
          );
        }
      });
    }

    await this.repo.markArchived(channel.guildId, channel.channelId, year, month);
  }

  private async sendEventChangeNotifications(
    channel: ScheduleChannel,
    changedItems: CalendarEventItem[],
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

      const wasInCache = this.cache.get(channel.calendarId)?.some((e) => e.id === item.id) ?? false;

      if (item.status === "cancelled") {
        lines.push(`🗑️ Event removed: ${label}`);
      } else if (wasInCache) {
        lines.push(`✏️ Event updated: ${label}`);
      } else {
        lines.push(`✅ Event added: ${label}`);
      }
    }

    if (lines.length === 0) return;

    try {
      const logChannel = await this.client.channels.fetch(
        channel.logChannelId.toString(),
      ) as TextChannel;
      await logChannel.send({ content: lines.join("\n") });
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

    try {
      const logChannel = await this.client.channels.fetch(
        channel.logChannelId.toString(),
      ) as TextChannel;
      await logChannel.send({ content: message });
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: channel.logChannelId.toString() },
        "Failed to send error alert to log channel",
      );
    }
  }

  private async sendRecoveryNotification(channel: ScheduleChannel): Promise<void> {
    try {
      const logChannel = await this.client.channels.fetch(
        channel.logChannelId.toString(),
      ) as TextChannel;
      await logChannel.send({
        content: `✅ Schedule sync for <#${channel.channelId}> has recovered and is now working again.`,
      });
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: channel.logChannelId.toString() },
        "Failed to send recovery notification to log channel",
      );
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

    const discordChannel = await this.discordSemaphore.run(() =>
      this.client.channels.fetch(channel.channelId.toString()),
    ) as TextChannel;

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
