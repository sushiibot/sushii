import { and, asc, count, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  guildConfigsInAppPublic,
  sushiiUpdateDeliveriesInAppPublic,
  sushiiUpdateIntrosInAppPublic,
  sushiiUpdatePostsInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";

import type {
  ClaimResult,
  DeliveryResult,
  SushiiUpdatesRepository,
} from "../domain/SushiiUpdatesRepository";
import type { RelayTarget, UpdatePost } from "../domain/UpdatePost";

const posts = sushiiUpdatePostsInAppPublic;
const deliveries = sushiiUpdateDeliveriesInAppPublic;
const configs = guildConfigsInAppPublic;
const intros = sushiiUpdateIntrosInAppPublic;

const FOREIGN_KEY_VIOLATION = "23503";

/** A retry row is due once 1, 2, 4 then 8 minutes passed since its last attempt. */
const retryDue = sql`(${deliveries.status} = 'retry' AND ${deliveries.updatedAt} < now() - make_interval(mins => power(2, ${deliveries.attempts} - 1)::int))`;

function pgCode(err: unknown): string | undefined {
  for (let e = err; e instanceof Error; e = e.cause) {
    if ("code" in e && typeof e.code === "string") {
      return e.code;
    }
  }
  return undefined;
}

export class DrizzleSushiiUpdatesRepository implements SushiiUpdatesRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async savePost(post: UpdatePost): Promise<boolean> {
    const inserted = await this.db
      .insert(posts)
      .values({ messageId: BigInt(post.messageId), createdAt: post.createdAt })
      .onConflictDoNothing()
      .returning({ messageId: posts.messageId });
    return inserted.length > 0;
  }

  async deletePost(messageId: string): Promise<void> {
    await this.db.delete(posts).where(eq(posts.messageId, BigInt(messageId)));
  }

  async deletePostsBefore(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(posts)
      .where(lt(posts.createdAt, cutoff))
      .returning({ messageId: posts.messageId });
    return deleted.length;
  }

  async findPostsSince(since: Date): Promise<UpdatePost[]> {
    const rows = await this.db
      .select()
      .from(posts)
      .where(gte(posts.createdAt, since))
      .orderBy(asc(posts.createdAt));

    return rows.map((row) => ({
      messageId: row.messageId.toString(),
      createdAt: row.createdAt,
    }));
  }

  async findPendingTargets(
    postId: string,
    guildIds: string[],
  ): Promise<RelayTarget[]> {
    if (guildIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .select({
        guildId: configs.id,
        channelId: configs.logSushiiNotifications,
      })
      .from(configs)
      .where(
        and(
          // One array parameter, so a large cluster doesn't hit the bind parameter limit.
          sql`${configs.id} = ANY(${sql.param(guildIds)}::bigint[])`,
          isNotNull(configs.logSushiiNotifications),
          eq(configs.logSushiiNotificationsEnabled, true),
          eq(configs.sushiiUpdatesEnabled, true),
          sql`NOT EXISTS (SELECT 1 FROM ${deliveries} WHERE ${deliveries.postId} = ${BigInt(postId)} AND ${deliveries.guildId} = ${configs.id} AND NOT ${retryDue})`,
        ),
      );

    return rows.flatMap((row) =>
      row.channelId
        ? [
            {
              guildId: row.guildId.toString(),
              channelId: row.channelId.toString(),
            },
          ]
        : [],
    );
  }

  async claimDelivery(postId: string, guildId: string): Promise<ClaimResult> {
    try {
      const [row] = await this.db
        .insert(deliveries)
        .values({
          postId: BigInt(postId),
          guildId: BigInt(guildId),
          status: "claimed",
        })
        .onConflictDoUpdate({
          target: [deliveries.postId, deliveries.guildId],
          set: {
            status: "claimed",
            attempts: sql`${deliveries.attempts} + 1`,
            errorCode: null,
            updatedAt: sql`now()`,
          },
          setWhere: retryDue,
        })
        .returning({ attempts: deliveries.attempts });
      return row
        ? { kind: "claimed", attempt: row.attempts }
        : { kind: "taken" };
    } catch (err) {
      if (pgCode(err) === FOREIGN_KEY_VIOLATION) {
        return { kind: "post_deleted" };
      }
      throw err;
    }
  }

  async releaseClaim(postId: string, guildId: string): Promise<void> {
    await this.db
      .delete(deliveries)
      .where(
        and(
          eq(deliveries.postId, BigInt(postId)),
          eq(deliveries.guildId, BigInt(guildId)),
          eq(deliveries.status, "claimed"),
        ),
      );
  }

  async completeDelivery(
    postId: string,
    guildId: string,
    result: DeliveryResult,
  ): Promise<void> {
    await this.db
      .update(deliveries)
      .set({
        status: result.status,
        messageId: result.messageId ? BigInt(result.messageId) : null,
        errorCode: result.errorCode ?? null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(deliveries.postId, BigInt(postId)),
          eq(deliveries.guildId, BigInt(guildId)),
        ),
      );
  }

  async claimIntro(guildId: string): Promise<boolean> {
    const inserted = await this.db
      .insert(intros)
      .values({ guildId: BigInt(guildId) })
      .onConflictDoNothing()
      .returning({ guildId: intros.guildId });
    return inserted.length > 0;
  }

  async countStuckClaims(from: Date, to: Date): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(deliveries)
      .where(
        and(
          eq(deliveries.status, "claimed"),
          gte(deliveries.updatedAt, from),
          lt(deliveries.updatedAt, to),
        ),
      );
    return row?.n ?? 0;
  }
}
