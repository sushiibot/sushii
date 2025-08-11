import type {
  GuildMessageCreatePayload,
  GuildMessageUpdatePayload,
} from "../types/GuildMessagePayloads";
import type { MessageData } from "../types/MessageData";

export class MessageLogEvent {
  constructor(
    public readonly messageId: string,
    public readonly authorId: string,
    public readonly channelId: string,
    public readonly guildId: string,
    public readonly content: string,
    public readonly createdAt: Date,
    public readonly discordMessage: MessageData,
  ) {}

  static create(
    messageId: string,
    authorId: string,
    channelId: string,
    guildId: string,
    content: string,
    createdAt: Date,
    discordMessage: MessageData,
  ): MessageLogEvent {
    return new MessageLogEvent(
      messageId,
      authorId,
      channelId,
      guildId,
      content,
      createdAt,
      discordMessage,
    );
  }

  static fromRawMessageCreate(
    payload: GuildMessageCreatePayload | GuildMessageUpdatePayload,
  ): MessageLogEvent {
    const messageData: MessageData = {
      id: payload.id,
      channel_id: payload.channel_id,
      author: {
        id: payload.author.id,
        username: payload.author.username,
        discriminator: payload.author.discriminator,
        avatar: payload.author.avatar,
        bot: payload.author.bot || false,
        global_name: payload.author.global_name || null,
      },
      content: payload.content || "",
      timestamp: payload.timestamp,
      sticker_items: payload.sticker_items?.map((sticker) => ({
        id: sticker.id,
        name: sticker.name,
        format_type: sticker.format_type,
      })),
      attachments: payload.attachments?.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        size: attachment.size,
        url: attachment.url,
        proxy_url: attachment.proxy_url,
        width: attachment.width,
        height: attachment.height,
        content_type: attachment.content_type,
      })),
      referenced_message: payload.referenced_message
        ? {
            id: payload.referenced_message.id,
            author: {
              id: payload.referenced_message.author.id,
            },
          }
        : undefined,
    };

    return new MessageLogEvent(
      payload.id,
      payload.author.id,
      payload.channel_id,
      payload.guild_id,
      payload.content || "",
      new Date(payload.timestamp),
      messageData,
    );
  }
}
