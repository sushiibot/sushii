import type { SQL } from "drizzle-orm";
import { and, count, eq, gte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { feedbackInAppPublic } from "@/infrastructure/database/schema";

import type {
  Feedback,
  FeedbackRepository,
  NewFeedback,
} from "../domain/Feedback";
import {
  isFeedbackFeature,
  isFeedbackKind,
  isFeedbackSource,
} from "../domain/Feedback";

type FeedbackRow = typeof feedbackInAppPublic.$inferSelect;
type Db = Pick<NodePgDatabase<typeof schema>, "select">;

function toDomain(row: FeedbackRow): Feedback {
  if (!isFeedbackSource(row.source)) {
    throw new Error("Invalid feedback source", { cause: row.source });
  }
  if (!isFeedbackKind(row.kind)) {
    throw new Error("Invalid feedback kind", { cause: row.kind });
  }
  if (row.feature !== null && !isFeedbackFeature(row.feature)) {
    throw new Error("Invalid feedback feature", { cause: row.feature });
  }

  return {
    id: row.id,
    userId: row.userId.toString(),
    guildId: row.guildId?.toString() ?? null,
    source: row.source,
    kind: row.kind,
    feature: row.feature,
    traceId: row.traceId,
    content: row.content,
    createdAt: row.createdAt,
  };
}

async function countSince(db: Db, userId: bigint, since: SQL): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(feedbackInAppPublic)
    .where(
      and(
        eq(feedbackInAppPublic.userId, userId),
        gte(feedbackInAppPublic.createdAt, since),
      ),
    );

  return row?.count ?? 0;
}

export class DrizzleFeedbackRepository implements FeedbackRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async insertWithinLimit(
    feedback: NewFeedback,
    limit: number,
    windowSeconds: number,
  ): Promise<Feedback | null> {
    const userId = BigInt(feedback.userId);

    return this.db.transaction(async (tx) => {
      // Snowflakes are globally unique, so the user ID can't collide with the guild-ID locks elsewhere.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${userId})`);

      // DB clock, so the window matches created_at's now() regardless of app clock skew.
      const since = sql`now() - make_interval(secs => ${windowSeconds})`;
      if ((await countSince(tx, userId, since)) >= limit) {
        return null;
      }

      const [row] = await tx
        .insert(feedbackInAppPublic)
        .values({
          userId,
          guildId: feedback.guildId === null ? null : BigInt(feedback.guildId),
          source: feedback.source,
          kind: feedback.kind,
          feature: feedback.feature,
          traceId: feedback.traceId,
          content: feedback.content,
        })
        .returning();

      return toDomain(row);
    });
  }
}
