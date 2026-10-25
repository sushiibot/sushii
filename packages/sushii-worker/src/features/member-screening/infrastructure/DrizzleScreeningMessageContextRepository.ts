import { and, count, desc, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { messagesInAppPublic as messages } from "@/infrastructure/database/schema";

import type {
  CachedMessage,
  ScreeningMessageContextRepository,
} from "../domain/repositories/ScreeningMessageContextRepository";

// `created` is a timestamp without time zone holding UTC, so bounds are written and read as UTC.
function toTimestamp(date: Date): string {
  return date.toISOString();
}

// Default and Reply only, so joins, pins and AutoMod alerts don't count as the member's messages.
// Rows cached before `type` was stored have none and are treated as Default.
const isUserMessage = sql`coalesce(${messages.msg}->>'type', '0') in ('0', '19')`;

function fromTimestamp(value: string): Date {
  const iso = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(/(Z|[+-]\d{2}(:?\d{2})?)$/.test(iso) ? iso : `${iso}Z`);
}

export class DrizzleScreeningMessageContextRepository
  implements ScreeningMessageContextRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async recentInChannel(
    guildId: string,
    channelId: string,
    before: Date,
    limit: number,
  ): Promise<CachedMessage[]> {
    const rows = await this.db
      .select({
        messageId: messages.messageId,
        authorId: messages.authorId,
        authorName: sql<string>`coalesce(${messages.msg}->'member'->>'nick', ${messages.msg}->'author'->>'global_name', ${messages.msg}->'author'->>'username', ${messages.authorId}::text)`,
        content: messages.content,
        created: messages.created,
      })
      .from(messages)
      .where(
        and(
          eq(messages.guildId, BigInt(guildId)),
          eq(messages.channelId, BigInt(channelId)),
          lt(messages.created, toTimestamp(before)),
          isUserMessage,
        ),
      )
      .orderBy(desc(messages.created))
      .limit(limit);

    return rows.reverse().map((row) => ({
      messageId: row.messageId.toString(),
      authorId: row.authorId.toString(),
      authorName: row.authorName,
      content: row.content,
      createdAt: fromTimestamp(row.created),
    }));
  }

  async countByAuthorSince(
    guildId: string,
    authorId: string,
    since: Date,
    before: Date,
  ): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.guildId, BigInt(guildId)),
          eq(messages.authorId, BigInt(authorId)),
          gte(messages.created, toTimestamp(since)),
          lt(messages.created, toTimestamp(before)),
          isUserMessage,
        ),
      );

    return row?.n ?? 0;
  }
}
