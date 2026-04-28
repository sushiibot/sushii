import type { Client, Message } from "discord.js";
import { EmbedBuilder, messageLink } from "discord.js";
import type { Logger } from "pino";
import type { Option } from "ts-results";
import { None, Some } from "ts-results";

import type { BotEmojiRepository } from "@/features/bot-emojis";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";
import { getAPIUserTag } from "@/utils/APIUser";
import buildChunks from "@/utils/buildChunks";
import Color from "@/utils/colors";

const MESSAGE_LOG_EMOJI_NAMES = ["message_delete", "message_edit"] as const;

import type { MessageDeleteAuditLogCache } from "./MessageDeleteAuditLogCache";
import type { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageLogBlockRepository } from "../domain/repositories/MessageLogBlockRepository";
import type { MessageLogEventRepository } from "../domain/repositories/MessageLogEventRepository";
import type {
  GuildMessageDeleteBulkPayload,
  GuildMessageDeletePayload,
  GuildMessageUpdatePayload,
} from "../domain/types/GuildMessagePayloads";

export class MessageLogService {
  constructor(
    private readonly client: Client,
    private readonly messageLogEventRepository: MessageLogEventRepository,
    private readonly messageLogBlockRepository: MessageLogBlockRepository,
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

    await this.sendEmbeds(
      [embed],
      guildConfig.loggingSettings.messageLogChannel,
      payload.guild_id,
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
    const embeds = this.buildBulkDeleteEmbed(payload, messageEvents, emojis);
    await this.sendEmbeds(
      embeds,
      guildConfig.loggingSettings.messageLogChannel,
      payload.guild_id,
    );
  }

  private async processUpdateEvent(
    payload: GuildMessageUpdatePayload,
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
    const embedOption = this.buildEditEmbed(payload, messageEvents[0], emojis);
    if (embedOption.some) {
      await this.sendEmbeds(
        [embedOption.val],
        guildConfig.loggingSettings.messageLogChannel,
        payload.guild_id,
      );
    }
  }

  private async sendEmbeds(
    embeds: EmbedBuilder[],
    logChannelId: string,
    guildId: string,
  ): Promise<Message | null> {
    const channel = this.client.channels.cache.get(logChannelId);
    if (!channel || !channel.isSendable()) {
      this.logger.warn(
        {
          guildId,
          channelId: logChannelId,
        },
        "Log msg channel not found or not sendable",
      );
      return null;
    }

    try {
      let firstMessage: Message | null = null;

      // Discord limits total embed size to 6000 chars per message.
      // Group embeds into batches where the sum of description lengths stays under that.
      const MAX_TOTAL_EMBED_SIZE = 6000;
      const MAX_EMBEDS_PER_MESSAGE = 10;
      const batches: EmbedBuilder[][] = [];
      let currentBatch: EmbedBuilder[] = [];
      let currentBatchSize = 0;

      for (const embed of embeds) {
        const descLen = embed.data.description?.length ?? 0;
        if (
          currentBatch.length > 0 &&
          (currentBatchSize + descLen > MAX_TOTAL_EMBED_SIZE ||
            currentBatch.length >= MAX_EMBEDS_PER_MESSAGE)
        ) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchSize = 0;
        }
        currentBatch.push(embed);
        currentBatchSize += descLen;
      }
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }

      for (const batch of batches) {
        const sent = await channel.send({
          embeds: batch.map((e) => e.toJSON()),
        });

        if (firstMessage === null) {
          firstMessage = sent;
        }
      }
      return firstMessage;
    } catch (err) {
      this.logger.warn(
        {
          guildId,
          channelId: logChannelId,
          err,
        },
        "Failed to send message log",
      );
      return null;
    }
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

    const authorIcon = msg.author.avatar
      ? this.client.rest.cdn.avatar(msg.author.id, msg.author.avatar)
      : this.client.rest.cdn.defaultAvatar(
          parseInt(msg.author.discriminator, 10),
        );

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
        text: `Message ID: ${messageEvent.messageId}`,
      })
      .setTimestamp(new Date());
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
  ): EmbedBuilder[] {
    const deleteCount = messageEvents.length.toLocaleString();
    const description = `${emojis.message_delete} **${deleteCount} messages deleted in <#${payload.channel_id}>**`;

    const messageStrings = messageEvents.map((m) => {
      let msgStr = `<@${m.authorId}>: `;

      if (m.content) {
        msgStr += `${m.content}`;
      }

      const msg = m.discordMessage;

      if (msg.sticker_items && msg.sticker_items.length > 0) {
        const sticker = msg.sticker_items[0];
        const stickerURL = this.client.rest.cdn.sticker(sticker.id);

        msgStr += `\n> **Sticker:** [${sticker.name}](${stickerURL})`;
      }

      if (msg.attachments && msg.attachments.length > 0) {
        const attachments = msg.attachments
          .map((a) => `> [${a.filename}](${a.proxy_url})`)
          .join("\n");

        msgStr += `\n> **Attachments:**\n${attachments}`;
      }

      return msgStr;
    });

    const embedChunks = buildChunks(
      [description, ...messageStrings],
      "\n",
      4096,
    );

    const embeds = embedChunks.map((chunk) =>
      new EmbedBuilder().setDescription(chunk).setColor(Color.Error),
    );

    embeds[embeds.length - 1] = embeds[embeds.length - 1].setTimestamp(
      new Date(),
    );

    return embeds;
  }

  private quoteMarkdownString(str: string): string {
    return str.split("\n").join("\n> ");
  }
}
