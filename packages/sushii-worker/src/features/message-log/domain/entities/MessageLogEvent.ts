import type {
  GuildMessageCreatePayload,
  GuildMessageUpdatePayload,
} from "../types/GuildMessagePayloads";
import type { MessageData } from "../types/MessageData";

const AUTOMOD_ALERT_MESSAGE_TYPE = 24;
const MAX_STORED_EMBEDS = 5;
const MAX_STORED_EMBED_CHARS = 2000;

type StoredEmbed = NonNullable<MessageData["embeds"]>[number];

interface RawEmbed {
  title?: string;
  description?: string;
  fields?: { name: string; value: string }[];
}

function takeBudget(text: string | undefined, budget: { left: number }) {
  if (!text || budget.left <= 0) {
    return undefined;
  }

  const taken = Array.from(text).slice(0, budget.left);
  budget.left -= taken.length;
  return taken.join("");
}

function toStoredEmbeds(embeds: RawEmbed[] | undefined) {
  if (!embeds || embeds.length === 0) {
    return undefined;
  }

  const budget = { left: MAX_STORED_EMBED_CHARS };
  const stored: StoredEmbed[] = [];

  for (const embed of embeds.slice(0, MAX_STORED_EMBEDS)) {
    if (budget.left <= 0) {
      break;
    }

    // Fields first: AutoMod alerts keep the rule name there, and a long flagged message must not crowd it out.
    const fields: { name: string; value: string }[] = [];
    for (const field of embed.fields ?? []) {
      if (budget.left <= 0) {
        break;
      }

      fields.push({
        name: takeBudget(field.name, budget) ?? "",
        value: takeBudget(field.value, budget) ?? "",
      });
    }
    const title = takeBudget(embed.title, budget);
    const description = takeBudget(embed.description, budget);

    stored.push({
      title,
      description,
      fields: fields.length > 0 ? fields : undefined,
    });
  }

  return stored.length > 0 ? stored : undefined;
}

function toAuthorizingOwners(
  owners: Partial<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(owners)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

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

  get interactionUserId(): string | undefined {
    return this.discordMessage.interaction_metadata?.user_id;
  }

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
    const isBot = payload.author.bot || false;
    const metadata = payload.interaction_metadata;

    const messageData: MessageData = {
      id: payload.id,
      channel_id: payload.channel_id,
      type: payload.type,
      author: {
        id: payload.author.id,
        username: payload.author.username,
        discriminator: payload.author.discriminator,
        avatar: payload.author.avatar,
        bot: isBot,
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
      member: payload.member
        ? {
            avatar: payload.member.avatar ?? null,
            nick: payload.member.nick ?? null,
          }
        : undefined,
      interaction_metadata: metadata
        ? {
            id: metadata.id,
            type: metadata.type,
            user_id: metadata.user.id,
            authorizing_integration_owners: toAuthorizingOwners(
              metadata.authorizing_integration_owners,
            ),
          }
        : undefined,
      embeds:
        payload.type === AUTOMOD_ALERT_MESSAGE_TYPE || isBot
          ? toStoredEmbeds(payload.embeds)
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
