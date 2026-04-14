import type { Client, GuildTextBasedChannel } from "discord.js";
import { ContainerBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder } from "discord.js";
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

const ALERT_RATE_LIMIT_MS = 24 * 60 * 60 * 1000; // 24 hours

const PUBLISHER_EMOJI_NAMES = ["success", "warning", "trash", "message_edit"] as const;

function isDiscordUnknownMessageError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: number }).code === 10008
  );
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
  ) {}

  private async fetchTextChannel(
    channelId: string,
    context: string,
  ): Promise<GuildTextBasedChannel | null> {
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

  async syncMessages(
    channel: Schedule,
    year: number,
    month: number,
    chunks: ReturnType<typeof renderSchedule>,
  ): Promise<void> {
    const existingMessages = await this.repo.getMessages(
      channel.guildId,
      channel.calendarId,
      year,
      month,
    );

    const discordChannel = await this.fetchTextChannel(
      channel.channelId.toString(),
      "syncMessages",
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
              channel.calendarId,
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
                channel.calendarId,
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
            channel.calendarId,
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

    if (excessMessages.length > 0) {
      await this.repo.deleteMessagesAboveIndex(
        channel.guildId,
        channel.calendarId,
        year,
        month,
        chunks.length - 1,
      );
    }
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
    const discordChannel = await this.fetchTextChannel(
      channel.channelId.toString(),
      "archiveMonth",
    );

    if (discordChannel) {
      for (let i = 0; i < archiveChunks.length; i++) {
        const chunk = archiveChunks[i];
        const existing = unarchivedMessages.find((m) => m.messageIndex === i);

        await this.discordSemaphore.run(async () => {
          if (existing) {
            try {
              const discordMsg = await discordChannel.messages.fetch(existing.messageId.toString());
              await discordMsg.edit({
                components: [chunk.container],
                flags: MessageFlags.IsComponentsV2,
              });
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
              this.logger.warn(
                { err, messageId: existing.messageId.toString() },
                "Failed to edit archived message",
              );
            }
          } else {
            try {
              const newMsg = await discordChannel.send({
                components: [chunk.container],
                flags: MessageFlags.IsComponentsV2,
              });
              await this.repo.upsertMessage(
                channel.guildId,
                channel.calendarId,
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
    const lines: string[] = [];
    const changes = classifyChanges(changedItems, previousEvents);
    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);

    for (const change of changes) {
      if (change.kind === "removed") {
        const prevEvent = change.previousEvent;
        const prevTimePart = prevEvent ? formatEventTimestamp(prevEvent) : "";
        const summary = prevEvent?.summary ?? change.item.summary ?? "(unknown event)";
        const cancelLabel = prevTimePart ? `${prevTimePart} ${summary}` : summary;
        lines.push(`${emojis.trash} Event removed: ${cancelLabel}`);
      } else {
        const event = toScheduleEvent(change.item);
        const timePart = formatEventTimestamp(event);

        const issue = calendarItemIssues(change.item);
        const hasIssues = issue !== null;
        const titleDisplay = issue
          ? `*(${issue.kind.replace("_", " ")})*`
          : event.summary;
        const label = timePart ? `${timePart} ${titleDisplay}` : titleDisplay;

        if (issue) {
          lines.push(
            `${emojis.warning} Event ${change.kind} (${issue.label.toLowerCase()}): ${label}`,
          );
        } else if (change.kind === "updated") {
          lines.push(`${emojis.message_edit} Event updated: ${label}`);
        } else {
          lines.push(`${emojis.success} Event added: ${label}`);
        }
      }
    }

    if (lines.length === 0) return;

    const logChannel = await this.fetchTextChannel(
      channel.logChannelId.toString(),
      "sendEventChangeNotifications",
    );
    if (!logChannel) return;

    const raw = lines.join("\n");
    const content = raw.length > 4000 ? raw.slice(0, 4000) + "\n…(truncated)" : raw;

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(content),
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

    const logChannel = await this.fetchTextChannel(
      channel.logChannelId.toString(),
      "sendEventIssuesAlert",
    );
    if (!logChannel) return;

    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    const container = new ContainerBuilder();
    let first = true;

    for (const { issue, timeParts } of groups.values()) {
      if (!first) {
        container.addSeparatorComponents(
          new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small),
        );
      }
      first = false;

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
      await logChannel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
      });
    } catch (err) {
      this.logger.warn(
        { err, logChannelId: channel.logChannelId.toString() },
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
    if (
      channel.lastErrorAt &&
      Date.now() - channel.lastErrorAt.getTime() < ALERT_RATE_LIMIT_MS
    ) {
      return;
    }

    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    const message =
      statusCode === 403
        ? `${emojis.warning} <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> is no longer accessible (permission denied). Please ensure the calendar is set to public.`
        : statusCode === 404
          ? `${emojis.warning} <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> was not found (404). The calendar may have been deleted or the ID is invalid.`
          : `${emojis.warning} <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> encountered an error (${statusCode}). Please check your calendar configuration.`;

    const logChannel = await this.fetchTextChannel(
      channel.logChannelId.toString(),
      "sendPermanentErrorAlert",
    );
    if (!logChannel) return;

    const alertContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(message),
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

  async sendRecoveryNotification(channel: Schedule): Promise<void> {
    const logChannel = await this.fetchTextChannel(
      channel.logChannelId.toString(),
      "sendRecoveryNotification",
    );
    if (!logChannel) return;

    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    const recoveryContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${emojis.success} Schedule sync for <#${channel.channelId}> is back online.`,
      ),
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
}
