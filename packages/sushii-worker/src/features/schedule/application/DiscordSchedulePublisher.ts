import opentelemetry, { SpanStatusCode } from "@opentelemetry/api";
import type { Client } from "discord.js";
import { ContainerBuilder, DiscordAPIError, MessageFlags, RESTJSONErrorCodes, Routes, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder, time, TimestampStyles } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { Semaphore } from "@/shared/infrastructure/concurrency/Semaphore";
import type { Schedule } from "@/features/schedule/domain/entities/Schedule";
import type { ScheduleMessage } from "@/features/schedule/domain/entities/ScheduleMessage";
import type { ScheduleMessageRepository } from "@/features/schedule/domain/repositories/ScheduleMessageRepository";
import { renderSchedule } from "@/features/schedule/presentation/views/ScheduleMessageBuilder";
import { formatEventTimestamp } from "@/features/schedule/presentation/views/ScheduleFormatting";
import { classifyChanges } from "@/features/schedule/domain/value-objects/CalendarEventChange";
import { calendarItemIssues, type CalendarEventIssue } from "@/features/schedule/domain/value-objects/CalendarEventIssue";
import type { CalendarEventItem } from "@/features/schedule/infrastructure/google/GoogleCalendarClient";
import { toScheduleEvent } from "@/features/schedule/infrastructure/google/CalendarEventMapper";
import type { ScheduleEvent } from "@/features/schedule/domain/entities/ScheduleEvent";
import type { ScheduleMetrics } from "@/features/schedule/infrastructure/metrics/ScheduleMetrics";

const tracer = opentelemetry.trace.getTracer("schedule");

const ALERT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours

const PUBLISHER_EMOJI_NAMES = ["success", "warning", "trash", "message_edit"] as const;

function formatEventTs(event: ScheduleEvent): string {
  const date = event.getDate();
  if (!date) return "";
  return event.isAllDay
    ? time(date, TimestampStyles.ShortDate)
    : time(date, TimestampStyles.ShortDateShortTime);
}

/**
 * Returns diff lines for an updated event: strikethrough old values next to new ones.
 * Only includes lines for fields that actually changed.
 * The returned lines slot in after the action header line.
 */
function buildUpdateDiffLines(prev: ScheduleEvent, next: ScheduleEvent): string[] {
  const lines: string[] = [];

  const titleChanged = prev.summary !== next.summary;
  if (titleChanged) {
    lines.push(`-# ~~${prev.summary}~~`);
  }

  const prevDate = prev.getDate();
  const nextDate = next.getDate();
  const timeChanged =
    prevDate?.getTime() !== nextDate?.getTime() || prev.isAllDay !== next.isAllDay;

  if (timeChanged) {
    const prevTs = prevDate ? formatEventTs(prev) : "unknown time";
    const nextTs = nextDate ? formatEventTs(next) : "unknown time";
    const relTs = nextDate ? `  (${time(nextDate, TimestampStyles.RelativeTime)})` : "";
    lines.push(`~~${prevTs}~~ → ${nextTs}${relTs}`);
  } else if (nextDate) {
    const absTs = formatEventTs(next);
    lines.push(`${absTs}  (${time(nextDate, TimestampStyles.RelativeTime)})`);
  }

  return lines;
}

function isDiscordUnknownMessageError(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage;
}

function isChannelInaccessibleError(err: unknown): boolean {
  return (
    err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.UnknownChannel ||
      err.code === RESTJSONErrorCodes.MissingAccess ||
      err.code === RESTJSONErrorCodes.MissingPermissions)
  );
}

function componentsV2Body(container: ContainerBuilder) {
  return { components: [container.toJSON()], flags: MessageFlags.IsComponentsV2 };
}

function isAlertRateLimited(lastErrorAt: Date | null): boolean {
  return !!lastErrorAt && Date.now() - lastErrorAt.getTime() < ALERT_RATE_LIMIT_MS;
}

function parseMessageId(resp: unknown): bigint {
  const id = (resp as { id?: string })?.id;
  if (typeof id !== "string") {
    throw new Error(`Unexpected REST response shape: missing id field`);
  }
  return BigInt(id);
}

function formatMaybeLinkedTitle(title: string, location: string | undefined | null): string {
  if (!location) return title;
  try {
    const safeUrl = location.replace(/\)/g, "%29");
    new URL(location);
    const escapedTitle = title.replace(/[\[\]]/g, "\\$&");
    return `[${escapedTitle}](${safeUrl})`;
  } catch {
    return title;
  }
}

/**
 * Handles all Discord-facing output for the schedule feature:
 * message sync, archive, and log-channel notifications.
 * Knows nothing about Google Calendar fetching or the in-memory cache.
 */
export class DiscordSchedulePublisher {
  // Limit concurrent Discord API calls to avoid rate limits
  private readonly discordSemaphore = new Semaphore(5);

  constructor(
    private readonly repo: ScheduleMessageRepository,
    private readonly client: Client,
    private readonly logger: Logger,
    private readonly emojiRepo: BotEmojiRepository,
    private readonly metrics: ScheduleMetrics,
  ) {}

  async syncMessages(
    channel: Schedule,
    year: number,
    month: number,
    chunks: ReturnType<typeof renderSchedule>,
  ): Promise<boolean> {
    return tracer.startActiveSpan(
      "schedule.discord.sync_messages",
      {
        attributes: {
          "guild.id": channel.guildId.toString(),
          "calendar.id": channel.calendarId,
          "channel.id": channel.channelId.toString(),
        },
      },
      async (span) => {
        try {
          const existingMessages = await this.repo.getMessages(
            channel.guildId,
            channel.calendarId,
            year,
            month,
          );

          const channelId = channel.channelId.toString();

          let edited = 0;
          let posted = 0;
          let reposted = 0;
          let unchanged = 0;

          for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const existing = existingMessages.find((m) => m.messageIndex === i);

            await this.discordSemaphore.run(async () => {
              if (existing) {
                if (existing.contentHash === chunk.hash) {
                  unchanged++;
                  return;
                }

                try {
                  await this.client.rest.patch(
                    Routes.channelMessage(channelId, existing.messageId.toString()),
                    { body: componentsV2Body(chunk.container) },
                  );
                  await this.repo.upsertMessage(
                    channel.guildId,
                    channel.calendarId,
                    channel.channelId,
                    year,
                    month,
                    i,
                    existing.messageId,
                    chunk.hash,
                  );
                  edited++;
                } catch (err: unknown) {
                  // 10008 = Unknown Message — repost as new
                  if (isDiscordUnknownMessageError(err)) {
                    const newMsgResp = await this.client.rest.post(
                      Routes.channelMessages(channelId),
                      { body: componentsV2Body(chunk.container) },
                    );
                    const newMessageId = parseMessageId(newMsgResp);
                    try {
                      await this.repo.upsertMessage(
                        channel.guildId,
                        channel.calendarId,
                        channel.channelId,
                        year,
                        month,
                        i,
                        newMessageId,
                        chunk.hash,
                      );
                    } catch (upsertErr) {
                      this.logger.warn(
                        { err: upsertErr, messageId: newMessageId.toString(), chunkIndex: i },
                        "Failed to record reposted schedule message in DB — will re-edit on next poll",
                      );
                    }
                    reposted++;
                  } else {
                    throw err;
                  }
                }
              } else {
                // Post new message
                const newMsgResp = await this.client.rest.post(
                  Routes.channelMessages(channelId),
                  { body: componentsV2Body(chunk.container) },
                );
                const newMessageId = parseMessageId(newMsgResp);
                try {
                  await this.repo.upsertMessage(
                    channel.guildId,
                    channel.calendarId,
                    channel.channelId,
                    year,
                    month,
                    i,
                    newMessageId,
                    chunk.hash,
                  );
                } catch (upsertErr) {
                  this.logger.warn(
                    { err: upsertErr, messageId: newMessageId.toString(), chunkIndex: i },
                    "Failed to record posted schedule message in DB — will repost on next poll",
                  );
                }
                posted++;
              }
            });
          }

          // Delete excess messages
          const excessMessages = existingMessages.filter(
            (m) => m.messageIndex >= chunks.length,
          );
          let deleted = 0;
          for (const msg of excessMessages) {
            await this.discordSemaphore.run(async () => {
              try {
                await this.client.rest.delete(
                  Routes.channelMessage(channelId, msg.messageId.toString()),
                );
                deleted++;
              } catch (err) {
                if (isChannelInaccessibleError(err)) {
                  throw err;
                }
                if (!isDiscordUnknownMessageError(err)) {
                  this.logger.warn(
                    { err, messageId: msg.messageId.toString() },
                    "Failed to delete excess schedule message",
                  );
                }
              }
            });
          }

          if (excessMessages.length > 0) {
            await this.repo.deleteMessagesAboveIndex(
              channel.guildId,
              channel.calendarId,
              year,
              month,
              chunks.length - 1,
            );
          }

          this.logger.debug(
            {
              guildId: channel.guildId.toString(),
              calendarId: channel.calendarId,
              edited,
              posted,
              reposted,
              deleted,
              unchanged,
            },
            "Discord schedule messages synced",
          );

          if (edited > 0) this.metrics.messagesSyncedCounter.add(edited, { operation: "edited" });
          if (posted > 0) this.metrics.messagesSyncedCounter.add(posted, { operation: "posted" });
          if (reposted > 0) this.metrics.messagesSyncedCounter.add(reposted, { operation: "reposted" });
          if (deleted > 0) this.metrics.messagesSyncedCounter.add(deleted, { operation: "deleted" });
          if (unchanged > 0) this.metrics.messagesSyncedCounter.add(unchanged, { operation: "unchanged" });

          // Only emit the span event when there's actual Discord API work — unchanged-only
          // runs have no actionable signal.
          if (edited + posted + reposted + deleted > 0) {
            span.addEvent("messages_synced", {
              "messages.edited": edited,
              "messages.posted": posted,
              "messages.reposted": reposted,
              "messages.deleted": deleted,
              "messages.unchanged": unchanged,
            });
          }

          return true;
        } catch (err) {
          if (isChannelInaccessibleError(err)) {
            this.logger.warn(
              { err, channelId: channel.channelId.toString() },
              "Schedule channel inaccessible",
            );
            span.setStatus({ code: SpanStatusCode.ERROR, message: "Schedule channel inaccessible" });
            return false;
          }
          span.recordException(err instanceof Error ? err : new Error(String(err)));
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  }

  /**
   * Edits/posts/deletes archive messages for a previous month and marks them archived.
   * Caller is responsible for fetching the events and rendering archiveChunks.
   */
  async archiveMonth(
    channel: Schedule,
    year: number,
    month: number,
    unarchivedMessages: ScheduleMessage[],
    archiveChunks: ReturnType<typeof renderSchedule>,
  ): Promise<void> {
    const channelId = channel.channelId.toString();
    let channelAccessible = true;

    for (let i = 0; i < archiveChunks.length; i++) {
      const chunk = archiveChunks[i];
      const existing = unarchivedMessages.find((m) => m.messageIndex === i);

      await this.discordSemaphore.run(async () => {
        if (existing) {
          try {
            await this.client.rest.patch(
              Routes.channelMessage(channelId, existing.messageId.toString()),
              { body: componentsV2Body(chunk.container) },
            );
            await this.repo.upsertMessage(
              channel.guildId,
              channel.calendarId,
              channel.channelId,
              year,
              month,
              i,
              existing.messageId,
              chunk.hash,
            );
          } catch (err) {
            if (isChannelInaccessibleError(err)) {
              channelAccessible = false;
            } else {
              this.logger.warn(
                { err, messageId: existing.messageId.toString() },
                "Failed to edit archived message",
              );
            }
          }
        } else {
          try {
            const newMsgResp = await this.client.rest.post(
              Routes.channelMessages(channelId),
              { body: componentsV2Body(chunk.container) },
            );
            await this.repo.upsertMessage(
              channel.guildId,
              channel.calendarId,
              channel.channelId,
              year,
              month,
              i,
              parseMessageId(newMsgResp),
              chunk.hash,
            );
          } catch (err) {
            if (isChannelInaccessibleError(err)) {
              channelAccessible = false;
            } else {
              this.logger.warn(
                { err, chunkIndex: i },
                "Failed to post new archive message",
              );
            }
          }
        }
      });

      if (!channelAccessible) {
        break;
      }
    }

    if (channelAccessible) {
      // Delete Discord messages and DB rows for indices beyond archiveChunks.length
      const excessMessages = unarchivedMessages.filter(
        (m) => m.messageIndex >= archiveChunks.length,
      );
      let excessDeleteAccessible = true;
      for (const msg of excessMessages) {
        await this.discordSemaphore.run(async () => {
          try {
            await this.client.rest.delete(
              Routes.channelMessage(channelId, msg.messageId.toString()),
            );
          } catch (err) {
            if (isChannelInaccessibleError(err)) {
              excessDeleteAccessible = false;
            } else if (!isDiscordUnknownMessageError(err)) {
              this.logger.warn(
                { err, messageId: msg.messageId.toString() },
                "Failed to delete excess archive message",
              );
            }
          }
        });
        if (!excessDeleteAccessible) {
          break;
        }
      }

      if (excessMessages.length > 0 && excessDeleteAccessible) {
        await this.repo.deleteMessagesAboveIndex(
          channel.guildId,
          channel.calendarId,
          year,
          month,
          archiveChunks.length - 1,
        );
      }
    }

    await this.repo.markArchived(channel.guildId, channel.calendarId, year, month);
  }

  async sendEventChangeNotifications(
    channel: Schedule,
    changedItems: CalendarEventItem[],
    previousEvents: Map<string, ScheduleEvent>,
  ): Promise<void> {
    const changes = classifyChanges(changedItems, previousEvents);
    if (changes.length === 0) return;

    const logChannelId = channel.logChannelId.toString();
    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);

    const container = new ContainerBuilder();
    if (channel.accentColor) {
      container.setAccentColor(channel.accentColor);
    }

    // Header: schedule name + counts summary
    const addedCount = changes.filter((c) => c.kind === "added").length;
    const updatedCount = changes.filter((c) => c.kind === "updated").length;
    const removedCount = changes.filter((c) => c.kind === "removed").length;

    const countParts: string[] = [];
    if (addedCount > 0) countParts.push(`${addedCount} added`);
    if (updatedCount > 0) countParts.push(`${updatedCount} updated`);
    if (removedCount > 0) countParts.push(`${removedCount} removed`);

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## ${channel.displayTitle}\n-# ${countParts.join("  ·  ")}`,
      ),
    );
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
    );

    // Per-event entries
    for (const change of changes) {
      const lines: string[] = [];

      if (change.kind === "removed") {
        const prevEvent = change.previousEvent;
        const summary = prevEvent?.summary ?? change.item.summary ?? "(unknown event)";

        const titleLine = formatMaybeLinkedTitle(summary, prevEvent?.location);
        lines.push(`${emojis.trash} **Removed** — **${titleLine}**`);

        if (prevEvent) {
          const date = prevEvent.getDate();
          if (date) {
            const absTs = prevEvent.isAllDay
              ? time(date, TimestampStyles.ShortDate)
              : time(date, TimestampStyles.ShortDateShortTime);
            lines.push(`-# ${absTs}`);
          }
        }
      } else {
        const event = toScheduleEvent(change.item);
        const issue = calendarItemIssues(change.item);

        // Build action label with emoji
        let actionEmoji: string;
        let actionLabel: string;
        if (issue) {
          actionEmoji = emojis.warning;
          actionLabel = `${change.kind === "updated" ? "Updated" : "Added"} *(${issue.label.toLowerCase()})*`;
        } else if (change.kind === "updated") {
          actionEmoji = emojis.message_edit;
          actionLabel = "Updated";
        } else {
          actionEmoji = emojis.success;
          actionLabel = "Added";
        }

        // location is the event link (e.g. YouTube/stream URL) — use it for the title hyperlink.
        // Skip link if there's an issue since the title may be missing.
        const titleLine = issue
          ? `*(${issue.kind.replace(/_/g, " ")})*`
          : formatMaybeLinkedTitle(event.summary, event.location);

        lines.push(`${actionEmoji} **${actionLabel}** — **${titleLine}**`);

        // For updates, show a before/after diff; for adds, just show the timestamp.
        if (change.kind === "updated" && change.previousEvent) {
          lines.push(...buildUpdateDiffLines(change.previousEvent, event));
        } else {
          const date = event.getDate();
          if (date) {
            const absTs = formatEventTs(event);
            lines.push(`${absTs}  (${time(date, TimestampStyles.RelativeTime)})`);
          }
        }
      }

      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n")),
      );
    }

    try {
      await this.client.rest.post(Routes.channelMessages(logChannelId), {
        body: componentsV2Body(container),
      });
      // Count changes only after confirming they were delivered
      for (const change of changes) {
        this.metrics.eventsChangedCounter.add(1, { kind: change.kind });
      }
    } catch (err) {
      this.logger.warn(
        { err, logChannelId },
        "Failed to send event change notifications to log channel",
      );
    }
  }

  async sendEventIssuesAlert(
    channel: Schedule,
    items: CalendarEventItem[],
  ): Promise<void> {
    type IssueGroup = { issue: CalendarEventIssue; timeParts: string[] };
    const groups = new Map<string, IssueGroup>();

    for (const item of items) {
      const event = toScheduleEvent(item);
      const timePart = formatEventTimestamp(event) || "unknown time";
      const issue = calendarItemIssues(item);
      if (issue) {
        const existing = groups.get(issue.kind);
        if (existing) {
          existing.timeParts.push(timePart);
        } else {
          groups.set(issue.kind, { issue, timeParts: [timePart] });
        }
      }
    }

    if (groups.size === 0) return;

    const logChannelId = channel.logChannelId.toString();

    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    const container = new ContainerBuilder();

    for (const [index, { issue, timeParts }] of [...groups.values()].entries()) {
      if (index > 0) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
        );
      }

      const count = timeParts.length;
      const noun = count === 1 ? "event" : "events";
      const verb = issue.kind === "private"
        ? `${count === 1 ? "is" : "are"} private`
        : `${count === 1 ? "has" : "have"} no title`;

      // Alert header
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `${emojis.warning} ${count} ${noun} ${verb} — won't show in the schedule`,
        ),
      );

      // Event list
      const eventList = timeParts.map((t) => `• ${t}`).join("\n");
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(eventList),
      );

      // Divider + how to fix
      container.addSeparatorComponents(
        new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
      );
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**How to fix:**\n${issue.actionMessage}`),
      );
    }

    try {
      await this.client.rest.post(Routes.channelMessages(logChannelId), {
        body: componentsV2Body(container),
      });
    } catch (err) {
      this.logger.warn(
        { err, logChannelId },
        "Failed to send event issues alert to log channel",
      );
    }
  }

  async sendPermanentErrorAlert(
    channel: Schedule,
    statusCode: number,
    reason: string,
  ): Promise<void> {
    // Rate limit: don't post if we already posted in the last 24h.
    // `channel.lastErrorAt` reflects the DB state from the previous poll cycle's
    // findAllDue fetch — not the recordFailure call that just ran. On the first
    // failure lastErrorAt is null so the alert fires; on repeat failures the
    // re-fetched schedule object from the next poll has the updated value.
    if (isAlertRateLimited(channel.lastErrorAt)) {
      this.logger.debug(
        {
          guildId: channel.guildId.toString(),
          calendarId: channel.calendarId,
          statusCode,
          lastErrorAt: channel.lastErrorAt,
        },
        "Skipping error alert — rate limited (already sent within 24h)",
      );
      return;
    }

    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    let message: string;
    if (statusCode === 403) {
      message = `${emojis.warning} <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> is no longer accessible (permission denied). Please ensure the calendar is set to public.`;
    } else if (statusCode === 404) {
      message = `${emojis.warning} <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> was not found (404). The calendar may have been deleted or the ID is invalid.`;
    } else {
      message = `${emojis.warning} <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> encountered an error (${statusCode}). Please check your calendar configuration.`;
    }

    const logChannelId = channel.logChannelId.toString();
    const alertContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(message),
    );

    try {
      await this.client.rest.post(Routes.channelMessages(logChannelId), {
        body: componentsV2Body(alertContainer),
      });
      this.logger.info(
        {
          guildId: channel.guildId.toString(),
          calendarId: channel.calendarId,
          statusCode,
        },
        "Schedule sync permanent error alert sent",
      );
    } catch (err) {
      this.logger.warn(
        { err, logChannelId },
        "Failed to send error alert to log channel",
      );
    }
  }

  async sendRecoveryNotification(channel: Schedule): Promise<void> {
    const logChannelId = channel.logChannelId.toString();
    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    const recoveryContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${emojis.success} Schedule sync for <#${channel.channelId}> is back online.`,
      ),
    );

    try {
      await this.client.rest.post(Routes.channelMessages(logChannelId), {
        body: componentsV2Body(recoveryContainer),
      });
      this.logger.info(
        { guildId: channel.guildId.toString(), calendarId: channel.calendarId },
        "Schedule sync recovery notification sent",
      );
    } catch (err) {
      this.logger.warn(
        { err, logChannelId },
        "Failed to send recovery notification to log channel",
      );
    }
  }

  async sendDiscordChannelErrorAlert(channel: Schedule): Promise<void> {
    if (isAlertRateLimited(channel.discordChannelFailedAt)) {
      this.logger.debug(
        {
          guildId: channel.guildId.toString(),
          calendarId: channel.calendarId,
          discordChannelFailedAt: channel.discordChannelFailedAt,
        },
        "Skipping Discord channel error alert — rate limited (already sent within 24h)",
      );
      return;
    }

    const logChannelId = channel.logChannelId.toString();
    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    const message = `${emojis.warning} <@${channel.configuredByUserId}> The schedule channel <#${channel.channelId}> is no longer accessible (the bot may have been removed from the server, or the channel was changed). Please use \`/schedule-config edit\` to update the schedule channel.`;

    const alertContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(message),
    );

    try {
      await this.client.rest.post(Routes.channelMessages(logChannelId), {
        body: componentsV2Body(alertContainer),
      });
      this.logger.info(
        { guildId: channel.guildId.toString(), calendarId: channel.calendarId },
        "Schedule Discord channel error alert sent",
      );
    } catch (err) {
      this.logger.warn(
        { err, logChannelId },
        "Failed to send Discord channel error alert to log channel",
      );
    }
  }
}
