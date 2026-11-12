import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { MessageData } from "@/features/message-log/domain/types/MessageData";
import {
  messageLogPostsInAppPublic,
  messagesInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type {
  CachedMessage,
  ProofSuggestionMessageRepository,
  TimeRange,
} from "../domain/ProofSuggestionMessageRepository";
import { AUTOMOD_ALERT_MESSAGE_TYPE } from "../domain/automodAlert";

const m = messagesInAppPublic;
const p = messageLogPostsInAppPublic;

/** Default, reply, slash command and context menu replies. */
const MESSAGE_TYPES = [0, 19, 20, 23];

// Rows cached before `type` was stored are treated as default messages.
const messageType = sql<number>`coalesce((${m.msg}->>'type')::int, 0)`;

function inRange(range: TimeRange): SQL | undefined {
  return and(
    gte(m.created, range.from.toISOString()),
    lte(m.created, range.to.toISOString()),
  );
}

function isTargetMessage(targetId: string): SQL | undefined {
  const target = BigInt(targetId);
  return or(
    and(
      eq(m.authorId, target),
      sql`${messageType} in (${sql.join(
        MESSAGE_TYPES.map((t) => sql`${t}`),
        sql`, `,
      )})`,
    ),
    and(
      eq(m.interactionUserId, target),
      sql`${messageType} <> ${AUTOMOD_ALERT_MESSAGE_TYPE}`,
    ),
  );
}

function notLoggedTo(logChannelIds: string[]): SQL | undefined {
  if (logChannelIds.length === 0) {
    return undefined;
  }

  return sql`not exists (select 1 from ${p} where ${p.messageId} = ${m.messageId} and ${inArray(
    p.logChannelId,
    logChannelIds.map((id) => BigInt(id)),
  )})`;
}

// `created` is a timestamp without time zone holding UTC.
function parseCreated(created: string): Date {
  return new Date(`${created.replace(" ", "T")}Z`);
}

function toCachedMessage(row: typeof m.$inferSelect): CachedMessage {
  return {
    id: row.messageId.toString(),
    channelId: row.channelId.toString(),
    authorId: row.authorId.toString(),
    interactionUserId: row.interactionUserId?.toString() ?? null,
    createdAt: parseCreated(row.created),
    content: row.content,
    msg: row.msg as MessageData,
  };
}

export class DrizzleProofSuggestionMessageRepository
  implements ProofSuggestionMessageRepository
{
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findTargetLogChannelIds(
    guildId: string,
    targetId: string,
    range: TimeRange,
  ): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ logChannelId: p.logChannelId })
      .from(m)
      .innerJoin(p, eq(p.messageId, m.messageId))
      .where(
        and(
          eq(m.guildId, BigInt(guildId)),
          inRange(range),
          isTargetMessage(targetId),
        ),
      );

    return rows.map((r) => r.logChannelId.toString());
  }

  async countTargetMessagesByChannel(
    guildId: string,
    targetId: string,
    range: TimeRange,
    hiddenLogChannelIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ channelId: m.channelId, total: count() })
      .from(m)
      .where(
        and(
          eq(m.guildId, BigInt(guildId)),
          inRange(range),
          isTargetMessage(targetId),
          notLoggedTo(hiddenLogChannelIds),
        ),
      )
      .groupBy(m.channelId);

    return new Map(rows.map((r) => [r.channelId.toString(), r.total]));
  }

  async findLatestTargetMessages(
    guildId: string,
    targetId: string,
    range: TimeRange,
    channelIds: string[],
    hiddenLogChannelIds: string[],
    limit: number,
  ): Promise<CachedMessage[]> {
    if (channelIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(m)
      .where(
        and(
          eq(m.guildId, BigInt(guildId)),
          inArray(
            m.channelId,
            channelIds.map((id) => BigInt(id)),
          ),
          inRange(range),
          isTargetMessage(targetId),
          notLoggedTo(hiddenLogChannelIds),
        ),
      )
      .orderBy(desc(m.created), desc(m.messageId))
      .limit(limit);

    return rows.map(toCachedMessage);
  }

  async findTargetAutomodAlerts(
    guildId: string,
    targetId: string,
    range: TimeRange,
    limit: number,
  ): Promise<CachedMessage[]> {
    const rows = await this.db
      .select()
      .from(m)
      .where(
        and(
          eq(m.guildId, BigInt(guildId)),
          eq(m.authorId, BigInt(targetId)),
          inRange(range),
          sql`${messageType} = ${AUTOMOD_ALERT_MESSAGE_TYPE}`,
        ),
      )
      .orderBy(desc(m.created), desc(m.messageId))
      .limit(limit);

    return rows.map(toCachedMessage);
  }

  async findByIds(
    guildId: string,
    messageIds: string[],
  ): Promise<CachedMessage[]> {
    if (messageIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(m)
      .where(
        and(
          eq(m.guildId, BigInt(guildId)),
          inArray(
            m.messageId,
            messageIds.map((id) => BigInt(id)),
          ),
        ),
      );

    return rows.map(toCachedMessage);
  }

  async findOthersInChannel(
    guildId: string,
    channelId: string,
    targetId: string,
    range: TimeRange,
    limit: number,
  ): Promise<CachedMessage[]> {
    const target = BigInt(targetId);
    const rows = await this.db
      .select()
      .from(m)
      .where(
        and(
          eq(m.guildId, BigInt(guildId)),
          eq(m.channelId, BigInt(channelId)),
          inRange(range),
          ne(m.authorId, target),
          sql`${m.interactionUserId} is distinct from ${target}::bigint`,
          sql`${messageType} <> ${AUTOMOD_ALERT_MESSAGE_TYPE}`,
        ),
      )
      .orderBy(desc(m.created), desc(m.messageId))
      .limit(limit);

    return rows.map(toCachedMessage);
  }
}
