import type { Client, Message } from "discord.js";
import {
  ApplicationIntegrationType,
  EmbedBuilder,
  escapeMarkdown,
  messageLink,
} from "discord.js";
import type { Logger } from "pino";
import type { Option } from "ts-results";
import { None, Some } from "ts-results";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { getAPIUserTag } from "@/utils/APIUser";
import Color from "@/utils/colors";

import type { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageLogBlockRepository } from "../domain/repositories/MessageLogBlockRepository";
import type { MessageLogEventRepository } from "../domain/repositories/MessageLogEventRepository";
import type { MessageLogPostRepository } from "../domain/repositories/MessageLogPostRepository";
import type {
  GuildMessageDeleteBulkPayload,
  GuildMessageDeletePayload,
  GuildMessageUpdatePayload,
} from "../domain/types/GuildMessagePayloads";
import type { MessageDeleteAuditLogCache } from "./MessageDeleteAuditLogCache";

const MESSAGE_LOG_EMOJI_NAMES = ["message_delete", "message_edit"] as const;
const GUILD_INSTALL_KEY = String(ApplicationIntegrationType.GuildInstall);
const USER_INSTALL_KEY = String(ApplicationIntegrationType.UserInstall);
const EMBED_DESCRIPTION_LIMIT = 4096;
const ELLIPSIS = "…";

export interface LogEmbed {
  embed: EmbedBuilder;
  /** Source message ids whose content is in this embed. */
  messageIds: string[];
}

interface SentLogPost {
  message: Message;
  messageIds: string[];
}

export class MessageLogService {
  constructor(
    private readonly client: Client,
    private readonly messageLogEventRepository: MessageLogEventRepository,
    private readonly messageLogBlockRepository: MessageLogBlockRepository,
    private readonly messageLogPostRepository: MessageLogPostRepository,
    private readonly guildConfigRepository: GuildConfigRepository,
    private readonly emojiRepository: BotEmojiRepository,
    private readonly auditLogCache: MessageDeleteAuditLogCache,
    private readonly logger: Logger,
  ) {}

  async handleRawMessageDelete(
    payload: GuildMessageDeletePayload,
  ): Promise<void> {
    await this.processDeleteEvent(payload);
  }

  async handleRawMessageDeleteBulk(
    payload: GuildMessageDeleteBulkPayload,
  ): Promise<void> {
    await this.processBulkDeleteEvent(payload);
  }

  async handleRawMessageUpdate(
    payload: GuildMessageUpdatePayload,
  ): Promise<void> {
    await this.processUpdateEvent(payload);
  }

  private async processDeleteEvent(
    payload: GuildMessageDeletePayload,
  ): Promise<void> {
    const guildConfig = await this.guildConfigRepository.findByGuildId(
      payload.guild_id,
    );

    if (
      !guildConfig.loggingSettings.messageLogChannel ||
      !guildConfig.loggingSettings.messageLogEnabled
    ) {
      return;
    }

    // Check if channel is blocked
    const channelBlock =
      await this.messageLogBlockRepository.findByGuildAndChannel(
        payload.guild_id,
        payload.channel_id,
      );

    if (channelBlock) {
      return;
    }

    const messageEvents = await this.messageLogEventRepository.findByMessageIds(
      [payload.id],
    );
    if (messageEvents.length === 0) {
      return;
    }

    const emojis = await this.emojiRepository.getEmojis(
      MESSAGE_LOG_EMOJI_NAMES,
    );
    const embed = this.buildDeleteEmbed(payload, messageEvents[0], emojis);

    // Wait up to 5s for the audit log executor. Resolves immediately if the
    // audit log already arrived, or with null if it never arrives (self-delete,
    // no audit log permissions, etc.).
    const executor = await this.auditLogCache.waitForExecutor(
      payload.guild_id,
      payload.channel_id,
      messageEvents[0].authorId,
    );

    if (executor) {
      embed.addFields([
        {
          name: "Deleted by",
          value: `<@${executor.executorId}> (${executor.executorUsername})`,
          inline: true,
        },
      ]);
    }

    const logChannelId = guildConfig.loggingSettings.messageLogChannel;
    const posts = await this.sendEmbeds(
      [{ embed, messageIds: [payload.id] }],
      logChannelId,
      payload.guild_id,
    );

    await this.savePostMappings(
      posts,
      payload.guild_id,
      payload.channel_id,
      logChannelId,
    );
  }

  private async processBulkDeleteEvent(
    payload: GuildMessageDeleteBulkPayload,
  ): Promise<void> {
    const guildConfig = await this.guildConfigRepository.findByGuildId(
      payload.guild_id,
    );

    if (
      !guildConfig.loggingSettings.messageLogChannel ||
      !guildConfig.loggingSettings.messageLogEnabled
    ) {
      return;
    }

    // Check if channel is blocked
    const channelBlock =
      await this.messageLogBlockRepository.findByGuildAndChannel(
        payload.guild_id,
        payload.channel_id,
      );

    if (channelBlock) {
      return;
    }

    const messageEvents = await this.messageLogEventRepository.findByMessageIds(
      payload.ids,
    );
    if (messageEvents.length === 0) {
      return;
    }

    const emojis = await this.emojiRepository.getEmojis(
      MESSAGE_LOG_EMOJI_NAMES,
    );
    const logChannelId = guildConfig.loggingSettings.messageLogChannel;
    const embeds = this.buildBulkDeleteEmbed(payload, messageEvents, emojis);
    const posts = await this.sendEmbeds(embeds, logChannelId, payload.guild_id);

    await this.savePostMappings(
      posts,
      payload.guild_id,
      payload.channel_id,
      logChannelId,
    );
  }

  private async savePostMappings(
    posts: SentLogPost[],
    guildId: string,
    channelId: string,
    logChannelId: string,
  ): Promise<void> {
    const rows = posts.flatMap((post) =>
      post.messageIds.map((messageId) => ({
        messageId,
        guildId,
        channelId,
        logChannelId,
        logMessageId: post.message.id,
      })),
    );

    if (rows.length === 0) {
      return;
    }

    try {
      await this.messageLogPostRepository.saveMany(rows);
    } catch (err) {
      this.logger.warn(
        { err, guildId, channelId, logChannelId, count: rows.length },
        "Failed to save message log post mappings",
      );
    }
  }

  private async processUpdateEvent(
    payload: GuildMessageUpdatePayload,
  ): Promise<void> {
    // Bot edits only refresh the cache; deferred app replies would otherwise post an edit log.
    if (payload.author?.bot) {
      return;
    }

    const guildConfig = await this.guildConfigRepository.findByGuildId(
      payload.guild_id,
    );

    if (
      !guildConfig.loggingSettings.messageLogChannel ||
      !guildConfig.loggingSettings.messageLogEnabled
    ) {
      return;
    }

    // Check if channel is blocked
    const channelBlock =
      await this.messageLogBlockRepository.findByGuildAndChannel(
        payload.guild_id,
        payload.channel_id,
      );

    if (channelBlock) {
      return;
    }

    const messageEvents = await this.messageLogEventRepository.findByMessageIds(
      [payload.id],
    );
    if (
      messageEvents.length === 0 ||
      messageEvents[0].discordMessage.author.bot
    ) {
      return;
    }

    const emojis = await this.emojiRepository.getEmojis(
      MESSAGE_LOG_EMOJI_NAMES,
    );
    const embedOption = this.buildEditEmbed(payload, messageEvents[0], emojis);
    if (embedOption.some) {
      await this.sendEmbeds(
        [{ embed: embedOption.val, messageIds: [] }],
        guildConfig.loggingSettings.messageLogChannel,
        payload.guild_id,
      );
    }
  }

  /** Returns the posts that were sent, each with the source message ids it shows. */
  private async sendEmbeds(
    embeds: LogEmbed[],
    logChannelId: string,
    guildId: string,
  ): Promise<SentLogPost[]> {
    const channel = this.client.channels.cache.get(logChannelId);
    if (!channel || !channel.isSendable()) {
      this.logger.warn(
        {
          guildId,
          channelId: logChannelId,
        },
        "Log msg channel not found or not sendable",
      );
      return [];
    }

    // Discord limits total embed size to 6000 chars per message.
    // Group embeds into batches where the sum of description lengths stays under that.
    const MAX_TOTAL_EMBED_SIZE = 6000;
    const MAX_EMBEDS_PER_MESSAGE = 10;
    const batches: LogEmbed[][] = [];
    let currentBatch: LogEmbed[] = [];
    let currentBatchSize = 0;

    for (const logEmbed of embeds) {
      const descLen = logEmbed.embed.data.description?.length ?? 0;
      if (
        currentBatch.length > 0 &&
        (currentBatchSize + descLen > MAX_TOTAL_EMBED_SIZE ||
          currentBatch.length >= MAX_EMBEDS_PER_MESSAGE)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchSize = 0;
      }
      currentBatch.push(logEmbed);
      currentBatchSize += descLen;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    const sentPosts: SentLogPost[] = [];
    try {
      for (const batch of batches) {
        const message = await channel.send({
          embeds: batch.map((e) => e.embed.toJSON()),
        });

        sentPosts.push({
          message,
          messageIds: batch.flatMap((e) => e.messageIds),
        });
      }
    } catch (err) {
      this.logger.warn(
        {
          guildId,
          channelId: logChannelId,
          sentCount: sentPosts.length,
          batchCount: batches.length,
          err,
        },
        "Failed to send message log",
      );
    }

    return sentPosts;
  }

  private buildDeleteEmbed(
    payload: GuildMessageDeletePayload,
    messageEvent: MessageLogEvent,
    emojis: Record<"message_delete" | "message_edit", string>,
  ): EmbedBuilder {
    let description = `${emojis.message_delete} **Message deleted in <#${payload.channel_id}>**\n`;

    const msg = messageEvent.discordMessage;

    if (messageEvent.content) {
      description += messageEvent.content;
      description += "\n";
    } else if (msg.interaction_metadata) {
      description += this.firstEmbedSummary(
        msg,
        EMBED_DESCRIPTION_LIMIT - description.length,
      );
    }

    const fields = [];

    if (msg.sticker_items && msg.sticker_items.length > 0) {
      const sticker = msg.sticker_items[0];
      const stickerURL = this.client.rest.cdn.sticker(sticker.id);

      fields.push({
        name: "Stickers",
        value: `[${sticker.name}](${stickerURL})`,
      });
    }

    if (msg.attachments && msg.attachments.length > 0) {
      let attachments = msg.attachments
        .map((a) => `[${a.filename}](${a.proxy_url})`)
        .join("\n")
        .substring(0, 1024);

      const lastNewline = attachments.lastIndexOf("\n");
      if (lastNewline !== -1) {
        attachments = attachments.substring(0, lastNewline);
      }

      fields.push({
        name: "Attachments",
        value: attachments,
      });
    }

    if (msg.referenced_message) {
      const replied = msg.referenced_message.id;
      const repliedURL = messageLink(
        messageEvent.channelId,
        replied,
        payload.guild_id,
      );

      fields.push({
        name: "Replied to",
        value: `<@${msg.referenced_message.author.id}> ${repliedURL}`,
      });
    }

    let footerText = `Message ID: ${messageEvent.messageId}`;

    if (msg.interaction_metadata) {
      const triggeredBy = msg.interaction_metadata.user_id;
      fields.push({
        name: "App response triggered by",
        value: `<@${triggeredBy}> · \`${triggeredBy}\``,
      });

      const owners = msg.interaction_metadata.authorizing_integration_owners;
      const isUserInstall =
        USER_INSTALL_KEY in owners && !(GUILD_INSTALL_KEY in owners);
      footerText = `${isUserInstall ? "User-installed app" : "Server app"} · ${footerText}`;
    }

    const authorIcon = msg.author.avatar
      ? this.client.rest.cdn.avatar(msg.author.id, msg.author.avatar)
      : this.client.rest.cdn.defaultAvatar(defaultAvatarIndex(msg.author));

    const authorTag = getAPIUserTag(msg.author);

    return new EmbedBuilder()
      .setAuthor({
        name: `${authorTag} (ID: ${msg.author.id})`,
        iconURL: authorIcon || undefined,
      })
      .setDescription(description)
      .setColor(Color.Error)
      .setFields(fields)
      .setFooter({
        text: footerText,
      })
      .setTimestamp(new Date());
  }

  private firstEmbedSummary(
    msg: MessageLogEvent["discordMessage"],
    maxLength: number,
  ): string {
    const embed = msg.embeds?.[0];
    if (!embed) {
      return "";
    }

    const parts = [embed.title, embed.description].filter(
      (part): part is string => !!part,
    );
    if (parts.length === 0) {
      return "";
    }

    const summary = escapeMarkdown(parts.join("\n"));
    if (summary.length < maxLength) {
      return `${summary}\n`;
    }

    // Truncate by code points before escaping so neither a surrogate pair nor an escape is split.
    const chars = Array.from(parts.join("\n"));
    const budget = Math.max(0, maxLength - 2);
    const escapedPrefix = (n: number) =>
      escapeMarkdown(chars.slice(0, n).join(""));
    let lo = 0;
    let hi = Math.min(chars.length, budget);
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (escapedPrefix(mid).length <= budget) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }

    return `${escapedPrefix(lo)}…\n`;
  }

  private buildEditEmbed(
    payload: GuildMessageUpdatePayload,
    messageEvent: MessageLogEvent,
    emojis: Record<"message_delete" | "message_edit", string>,
  ): Option<EmbedBuilder> {
    if (!payload.content) {
      return None;
    }

    if (payload.content === messageEvent.content) {
      return None;
    }

    const msg = messageEvent.discordMessage;

    let description = `${emojis.message_edit} **Message edited in <#${payload.channel_id}>**\n`;
    description += "**Before:**\n";
    description += this.quoteMarkdownString(messageEvent.content);
    description += "\n**After:**\n";
    description += this.quoteMarkdownString(payload.content);

    const authorIcon = msg.author.avatar
      ? this.client.rest.cdn.avatar(msg.author.id, msg.author.avatar)
      : this.client.rest.cdn.defaultAvatar(
          parseInt(msg.author.discriminator, 10),
        );

    const embed = new EmbedBuilder()
      .setAuthor({
        name: `${getAPIUserTag(msg.author)} (ID: ${msg.author.id})`,
        iconURL: authorIcon || undefined,
      })
      .setDescription(description.substring(0, 4096))
      .setColor(Color.Info)
      .setTimestamp(new Date());

    return Some(embed);
  }

  private buildBulkDeleteEmbed(
    payload: GuildMessageDeleteBulkPayload,
    messageEvents: MessageLogEvent[],
    emojis: Record<"message_delete" | "message_edit", string>,
  ): LogEmbed[] {
    const deleteCount = messageEvents.length.toLocaleString();
    const description = `${emojis.message_delete} **${deleteCount} messages deleted in <#${payload.channel_id}>**`;

    const entries = messageEvents.map((m) => ({
      text: this.buildBulkDeleteLine(m),
      messageId: m.messageId,
    }));

    const chunks = chunkEntries(description, entries, EMBED_DESCRIPTION_LIMIT);

    const embeds = chunks.map((chunk) => ({
      embed: new EmbedBuilder()
        .setDescription(chunk.text)
        .setColor(Color.Error),
      messageIds: chunk.messageIds,
    }));

    embeds[embeds.length - 1].embed.setTimestamp(new Date());

    return embeds;
  }

  private buildBulkDeleteLine(m: MessageLogEvent): string {
    const msg = m.discordMessage;
    const prefix = `<@${m.authorId}>: `;

    let suffix = "";
    if (msg.interaction_metadata) {
      suffix += ` (triggered by <@${msg.interaction_metadata.user_id}>)`;
    }

    if (msg.sticker_items && msg.sticker_items.length > 0) {
      const sticker = msg.sticker_items[0];
      const stickerURL = this.client.rest.cdn.sticker(sticker.id);

      suffix += `\n> **Sticker:** [${sticker.name}](${stickerURL})`;
    }

    if (msg.attachments && msg.attachments.length > 0) {
      const attachments = msg.attachments
        .map((a) => `> [${a.filename}](${a.proxy_url})`)
        .join("\n");

      suffix += `\n> **Attachments:**\n${attachments}`;
    }

    const bodyBudget = EMBED_DESCRIPTION_LIMIT - prefix.length - suffix.length;
    if (bodyBudget < ELLIPSIS.length) {
      return truncateCodePoints(
        prefix + m.content + suffix,
        EMBED_DESCRIPTION_LIMIT,
      );
    }

    let body = m.content;
    if (!body && msg.interaction_metadata) {
      // firstEmbedSummary returns at most maxLength chars including its trailing newline.
      body = this.firstEmbedSummary(msg, bodyBudget + 1).replace(/\n$/, "");
    }

    return prefix + truncateCodePoints(body, bodyBudget) + suffix;
  }

  private quoteMarkdownString(str: string): string {
    return str.split("\n").join("\n> ");
  }
}

/** Cuts by code points so a surrogate pair is never split, and never leaves a dangling escape. */
function truncateCodePoints(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str;
  }

  const budget = maxLength - ELLIPSIS.length;
  let out = "";
  for (const char of str) {
    if (out.length + char.length > budget) {
      break;
    }
    out += char;
  }

  const trailingBackslashes = /\\*$/.exec(out)?.[0].length ?? 0;
  if (trailingBackslashes % 2 === 1) {
    out = out.slice(0, -1);
  }

  return out + ELLIPSIS;
}

/**
 * Joins entries into chunks of at most `maxLength` chars without splitting an entry across chunks.
 * Entries longer than `maxLength` are truncated.
 */
export function chunkEntries(
  header: string,
  entries: { text: string; messageId: string }[],
  maxLength: number,
): { text: string; messageIds: string[] }[] {
  const joiner = "\n";
  const chunks: { text: string; messageIds: string[] }[] = [];
  let current = {
    text: truncateCodePoints(header, maxLength),
    messageIds: [] as string[],
  };

  for (const entry of entries) {
    const text = truncateCodePoints(entry.text, maxLength);
    if (
      current.text.length > 0 &&
      current.text.length + joiner.length + text.length > maxLength
    ) {
      chunks.push(current);
      current = { text: "", messageIds: [] };
    }

    current.text =
      current.text.length > 0 ? current.text + joiner + text : text;
    current.messageIds.push(entry.messageId);
  }

  if (current.text.length > 0 || current.messageIds.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

function defaultAvatarIndex(author: { id: string; discriminator: string }) {
  if (author.discriminator === "0") {
    return Number((BigInt(author.id) >> 22n) % 6n);
  }

  return Number(author.discriminator) % 5;
}
