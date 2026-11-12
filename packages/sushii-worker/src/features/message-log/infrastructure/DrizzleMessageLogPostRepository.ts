import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { messageLogPostsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type {
  MessageLogPost,
  MessageLogPostRepository,
  NewMessageLogPost,
} from "../domain/repositories/MessageLogPostRepository";

export class DrizzleMessageLogPostRepository
  implements MessageLogPostRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async saveMany(rows: NewMessageLogPost[]): Promise<void> {
    // Postgres rejects an upsert that touches the same row twice in one statement.
    const latestByMessage = new Map<string, NewMessageLogPost>();
    for (const row of rows) {
      latestByMessage.set(row.messageId, row);
    }

    if (latestByMessage.size === 0) {
      return;
    }

    await this.db
      .insert(messageLogPostsInAppPublic)
      .values(
        [...latestByMessage.values()].map((row) => ({
          messageId: BigInt(row.messageId),
          guildId: BigInt(row.guildId),
          channelId: BigInt(row.channelId),
          logChannelId: BigInt(row.logChannelId),
          logMessageId: BigInt(row.logMessageId),
        })),
      )
      .onConflictDoUpdate({
        target: messageLogPostsInAppPublic.messageId,
        set: {
          guildId: sql`excluded.guild_id`,
          channelId: sql`excluded.channel_id`,
          logChannelId: sql`excluded.log_channel_id`,
          logMessageId: sql`excluded.log_message_id`,
          createdAt: sql`excluded.created_at`,
        },
      });
  }

  async findByMessageIds(
    guildId: string,
    messageIds: string[],
  ): Promise<MessageLogPost[]> {
    if (messageIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(messageLogPostsInAppPublic)
      .where(
        and(
          eq(messageLogPostsInAppPublic.guildId, BigInt(guildId)),
          inArray(
            messageLogPostsInAppPublic.messageId,
            messageIds.map((id) => BigInt(id)),
          ),
        ),
      );

    return rows.map((row) => ({
      messageId: row.messageId.toString(),
      guildId: row.guildId.toString(),
      channelId: row.channelId.toString(),
      logChannelId: row.logChannelId.toString(),
      logMessageId: row.logMessageId.toString(),
      createdAt: row.createdAt,
    }));
  }

  async deleteBefore(date: Date): Promise<number> {
    const result = await this.db
      .delete(messageLogPostsInAppPublic)
      .where(lt(messageLogPostsInAppPublic.createdAt, date));

    return result.rowCount ?? 0;
  }
}
