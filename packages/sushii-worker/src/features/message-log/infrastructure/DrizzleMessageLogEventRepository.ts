import { lt, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";

import { messagesInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import { MessageLogEvent } from "../domain/entities/MessageLogEvent";
import type { MessageData } from "../domain/types/MessageData";
import type { MessageLogEventRepository } from "../domain/repositories/MessageLogEventRepository";

export class DrizzleMessageLogEventRepository
  implements MessageLogEventRepository
{
  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

  async save(event: MessageLogEvent): Promise<void> {
    this.logger.debug(
      { messageId: event.messageId, channelId: event.channelId },
      "Saving message log event",
    );

    const discordMessageJson = JSON.stringify(event.discordMessage);

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
      })
      .onConflictDoUpdate({
        target: messagesInAppPublic.messageId,
        set: {
          content: event.content,
          msg: sql`${discordMessageJson}`,
        },
      });
  }

  async findByMessageIds(messageIds: string[]): Promise<MessageLogEvent[]> {
    this.logger.debug({ messageIds }, "Finding message log events");

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
    this.logger.debug({ date }, "Deleting old message log events");

    const result = await this.db
      .delete(messagesInAppPublic)
      .where(lt(messagesInAppPublic.created, date.toISOString()));

    return result.rowCount || 0;
  }
}