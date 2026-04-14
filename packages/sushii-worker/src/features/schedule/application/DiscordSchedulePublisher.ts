import type { Client, GuildTextBasedChannel } from "discord.js";
import { ContainerBuilder, MessageFlags, TextDisplayBuilder } from "discord.js";
import type { Logger } from "pino";

import type { BotEmojiRepository } from "@/features/bot-emojis/domain";
import { Semaphore } from "@/shared/infrastructure/concurrency/Semaphore";
import type { ScheduleChannel } from "../domain/entities/ScheduleChannel";
import type { ScheduleChannelMessage } from "../domain/entities/ScheduleChannelMessage";
import type { ScheduleMessageRepository } from "../domain/repositories/ScheduleMessageRepository";
import { renderSchedule } from "../domain/services/ScheduleRenderService";
import { formatEventTimestamp } from "../domain/services/ScheduleFormatting";
import { classifyChanges } from "../domain/value-objects/CalendarEventChange";
import { calendarItemIssues } from "../domain/value-objects/CalendarEventIssue";
import type { CalendarEventItem } from "../infrastructure/google/GoogleCalendarClient";
import { toScheduleEvent } from "../infrastructure/google/CalendarEventMapper";
import type { ScheduleEvent } from "../domain/entities/ScheduleEvent";

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

  /**
   * Edits/posts/deletes archive messages for a previous month and marks them archived.
   * Caller is responsible for fetching the events and rendering archiveChunks.
   */
  async archiveMonth(
    channel: ScheduleChannel,
    year: number,
    month: number,
    unarchivedMessages: ScheduleChannelMessage[],
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
          channel.channelId,
          year,
          month,
          archiveChunks.length - 1,
        );
      }
    }

    await this.repo.markArchived(channel.guildId, channel.channelId, year, month);
  }

  async sendEventChangeNotifications(
    channel: ScheduleChannel,
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

        const issues = calendarItemIssues(change.item);
        const hasIssues = issues.length > 0;
        const titleDisplay = hasIssues
          ? `*(${issues[0].kind.replace("_", " ")})*`
          : event.summary;
        const label = timePart ? `${timePart} ${titleDisplay}` : titleDisplay;

        if (hasIssues) {
          for (const issue of issues) {
            lines.push(
              `${emojis.warning} Event ${change.kind} — ${issue.label}: ${label} — ${issue.actionMessage}`,
            );
          }
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
    channel: ScheduleChannel,
    items: CalendarEventItem[],
  ): Promise<void> {
    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    const lines = items.flatMap((item) => {
      const event = toScheduleEvent(item);
      const timePart = formatEventTimestamp(event) || "unknown time";

      return calendarItemIssues(item).map(
        (issue) => `${emojis.warning} ${issue.label}: ${timePart} — ${issue.actionMessage}`,
      );
    });

    const logChannel = await this.fetchTextChannel(
      channel.logChannelId.toString(),
      "sendEventIssuesAlert",
    );
    if (!logChannel) return;

    const container = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lines.join("\n")),
    );

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

    const emojis = await this.emojiRepo.getEmojis(PUBLISHER_EMOJI_NAMES);
    const message =
      statusCode === 403
        ? `${emojis.warning} <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> is no longer accessible (permission denied). Please ensure the calendar is set to public.`
        : `${emojis.warning} <@${channel.configuredByUserId}> The Google Calendar for <#${channel.channelId}> was not found (404). The calendar may have been deleted or the ID is invalid.`;

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

  async sendRecoveryNotification(channel: ScheduleChannel): Promise<void> {
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
