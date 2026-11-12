import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";

import { messagesInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageLogEventRepository } from "../domain/repositories/MessageLogEventRepository";
import type { MessageData } from "../domain/types/MessageData";

export class DrizzleMessageLogEventRepository
  implements MessageLogEventRepository
{
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async save(event: MessageLogEvent): Promise<void> {
    this.logger.trace(
      { messageId: event.messageId, channelId: event.channelId },
      "Saving message log event",
    );

    const discordMessageJson = JSON.stringify(event.discordMessage);
    const interactionUserId = event.interactionUserId
      ? BigInt(event.interactionUserId)
      : null;

    await this.db
      .insert(messagesInAppPublic)
      .values({
        messageId: BigInt(event.messageId),
        channelId: BigInt(event.channelId),
        guildId: BigInt(event.guildId),
        authorId: BigInt(event.authorId),
        content: event.content,
        created: event.createdAt.toISOString(),
        msg: sql`${discordMessageJson}`,
        interactionUserId,
      })
      .onConflictDoUpdate({
        target: messagesInAppPublic.messageId,
        set: {
          content: event.content,
          msg: this.mergedMsg(discordMessageJson),
          interactionUserId: sql`coalesce(excluded.interaction_user_id, ${messagesInAppPublic.interactionUserId})`,
        },
      });
  }

  async updateIfChanged(event: MessageLogEvent): Promise<boolean> {
    const discordMessageJson = JSON.stringify(event.discordMessage);
    const interactionUserId = event.interactionUserId
      ? BigInt(event.interactionUserId)
      : null;

    const result = await this.db
      .update(messagesInAppPublic)
      .set({
        content: event.content,
        msg: this.mergedMsg(discordMessageJson),
        interactionUserId: sql`coalesce(${interactionUserId}::bigint, ${messagesInAppPublic.interactionUserId})`,
      })
      .where(
        and(
          eq(messagesInAppPublic.messageId, BigInt(event.messageId)),
          or(
            sql`${messagesInAppPublic.content} is distinct from ${event.content}`,
            sql`${messagesInAppPublic.msg} -> 'embeds' is distinct from ${discordMessageJson}::jsonb -> 'embeds'`,
          ),
        ),
      );

    return (result.rowCount ?? 0) > 0;
  }

  // Update payloads can omit attribution; keep the stored keys unless the new payload has them.
  private mergedMsg(discordMessageJson: string) {
    return sql`coalesce(
      (select jsonb_object_agg(key, value) from jsonb_each(${messagesInAppPublic.msg}) where key in ('member', 'interaction_metadata')),
      '{}'::jsonb
    ) || ${discordMessageJson}::jsonb`;
  }

  async findByMessageIds(messageIds: string[]): Promise<MessageLogEvent[]> {
    this.logger.trace({ messageIds }, "Finding message log events");

    if (messageIds.length === 0) {
      return [];
    }

    const bigintIds = messageIds.map((id) => BigInt(id));

    const results = await this.db
      .select()
      .from(messagesInAppPublic)
      .where(inArray(messagesInAppPublic.messageId, bigintIds))
      .orderBy(messagesInAppPublic.created);

    return results.map((row) => {
      const discordMessage = row.msg as unknown as MessageData;

      return new MessageLogEvent(
        row.messageId.toString(),
        row.authorId.toString(),
        row.channelId.toString(),
        row.guildId.toString(),
        row.content,
        new Date(row.created),
        discordMessage,
      );
    });
  }

  async deleteMessagesBefore(date: Date): Promise<number> {
    this.logger.trace({ date }, "Deleting old message log events");

    const result = await this.db
      .delete(messagesInAppPublic)
      .where(lt(messagesInAppPublic.created, date.toISOString()));

    return result.rowCount || 0;
  }
}
