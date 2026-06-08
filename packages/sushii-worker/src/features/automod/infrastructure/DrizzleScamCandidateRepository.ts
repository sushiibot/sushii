import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  scamCandidateSightingsInAppPublic,
  scamCandidateStateInAppPublic,
} from "@/infrastructure/database/schema";

import type {
  NewScamCandidateSighting,
  ResolvedStatus,
  ScamCandidateTrigger,
  ScamCandidateRepository,
  ScamCandidateState,
  SightingThresholdResult,
  StoredClassificationResult,
  StoredImageResult,
} from "../domain/repositories/ScamCandidateRepository";

export class DrizzleScamCandidateRepository implements ScamCandidateRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async recordSightingAndCheckThreshold(
    sighting: NewScamCandidateSighting,
    windowMs: number,
    channelThreshold: number,
  ): Promise<SightingThresholdResult | null> {
    const { key, guildId, channelId, attachmentUrls } = sighting;
    const cutoff = new Date(Date.now() - windowMs);

    return this.db.transaction(async (tx) => {
      await tx.insert(scamCandidateSightingsInAppPublic).values({
        key,
        guildId,
        channelId,
        attachmentUrls,
      });

      const [counts] = await tx
        .select({
          channels: sql<number>`count(distinct ${scamCandidateSightingsInAppPublic.channelId})::int`,
        })
        .from(scamCandidateSightingsInAppPublic)
        .where(
          and(
            eq(scamCandidateSightingsInAppPublic.key, key),
            gte(scamCandidateSightingsInAppPublic.seenAt, cutoff),
          ),
        );

      if (!counts || counts.channels < channelThreshold) {
        return null;
      }

      const recentSightings = await tx
        .select({
          guildId: scamCandidateSightingsInAppPublic.guildId,
          attachmentUrls: scamCandidateSightingsInAppPublic.attachmentUrls,
        })
        .from(scamCandidateSightingsInAppPublic)
        .where(
          and(
            eq(scamCandidateSightingsInAppPublic.key, key),
            gte(scamCandidateSightingsInAppPublic.seenAt, cutoff),
          ),
        )
        .orderBy(
          sql`${scamCandidateSightingsInAppPublic.seenAt} desc`,
          sql`${scamCandidateSightingsInAppPublic.id} desc`,
        );

      const guildIds = [...new Set(recentSightings.map((s) => s.guildId))];
      const latestAttachmentUrls = recentSightings[0]?.attachmentUrls ?? [];

      return {
        guildIds,
        channelCount: counts.channels,
        attachmentUrls: latestAttachmentUrls,
      };
    });
  }

  async claimByHashKey(
    key: string,
    reviewId: string,
    triggeredByUserId: string,
    channelCount: number,
    guildIds: string[],
    trigger: ScamCandidateTrigger,
    attachmentUrls: string[],
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .insert(scamCandidateStateInAppPublic)
      .values({
        key,
        status: "claimed",
        trigger,
        reviewId,
        triggeredByUserId,
        channelCount,
        guildIds,
        seenByUserIds: [triggeredByUserId],
        attachmentUrls,
      })
      .onConflictDoNothing()
      .returning();

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async transitionToReadyToPost(
    key: string,
    opts: {
      newImageResults: StoredImageResult[];
      guildNames: string[];
    },
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .update(scamCandidateStateInAppPublic)
      .set({
        status: "ready_to_post",
        newImageResults: opts.newImageResults,
        guildNames: opts.guildNames,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scamCandidateStateInAppPublic.key, key),
          eq(scamCandidateStateInAppPublic.status, "claimed"),
        ),
      )
      .returning();

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async transitionFromReadyToPost(
    key: string,
    opts: {
      reviewChannelId: string;
      reviewMessageId: string;
      postedImageResults: StoredImageResult[];
      classificationResult: StoredClassificationResult | null;
    },
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .update(scamCandidateStateInAppPublic)
      .set({
        status: "reviewing",
        reviewChannelId: opts.reviewChannelId,
        reviewMessageId: opts.reviewMessageId,
        newImageResults: opts.postedImageResults,
        classificationResult: opts.classificationResult,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scamCandidateStateInAppPublic.key, key),
          eq(scamCandidateStateInAppPublic.status, "ready_to_post"),
        ),
      )
      .returning();

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async getPendingPostRows(): Promise<ScamCandidateState[]> {
    const rows = await this.db
      .select()
      .from(scamCandidateStateInAppPublic)
      .where(eq(scamCandidateStateInAppPublic.status, "ready_to_post"))
      .orderBy(asc(scamCandidateStateInAppPublic.claimedAt))
      .limit(25);

    return rows.map((row) => this.rowToState(row));
  }

  async appendSeenUser(
    key: string,
    userId: string,
    channelCount: number,
    guildIds: string[],
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .update(scamCandidateStateInAppPublic)
      .set({
        seenByUserIds: sql`ARRAY(SELECT DISTINCT unnest(${scamCandidateStateInAppPublic.seenByUserIds} || ARRAY[${userId}::text]))`,
        channelCount: sql`GREATEST(${scamCandidateStateInAppPublic.channelCount}, ${channelCount})`,
        guildIds: sql`ARRAY(SELECT DISTINCT unnest(${scamCandidateStateInAppPublic.guildIds} || ARRAY[${sql.join(guildIds.map((id) => sql`${id}::text`), sql`, `)}]))`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scamCandidateStateInAppPublic.key, key),
          sql`${scamCandidateStateInAppPublic.status} IN ('claimed', 'ready_to_post', 'reviewing')`,
        ),
      )
      .returning();

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async resolveReview(
    reviewId: string,
    status: ResolvedStatus,
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .update(scamCandidateStateInAppPublic)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(scamCandidateStateInAppPublic.reviewId, reviewId),
          sql`${scamCandidateStateInAppPublic.status} NOT IN ('ignored', 'added', 'reverted')`,
        ),
      )
      .returning();

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async revertReview(reviewId: string): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .update(scamCandidateStateInAppPublic)
      .set({ status: "reverted", updatedAt: new Date() })
      .where(
        and(
          eq(scamCandidateStateInAppPublic.reviewId, reviewId),
          eq(scamCandidateStateInAppPublic.status, "added"),
        ),
      )
      .returning();

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async getByReviewId(reviewId: string): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .select()
      .from(scamCandidateStateInAppPublic)
      .where(eq(scamCandidateStateInAppPublic.reviewId, reviewId));

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async getByHashKey(key: string): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .select()
      .from(scamCandidateStateInAppPublic)
      .where(eq(scamCandidateStateInAppPublic.key, key));

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async deleteByKey(key: string): Promise<void> {
    await this.db
      .delete(scamCandidateStateInAppPublic)
      .where(eq(scamCandidateStateInAppPublic.key, key));
  }

  async deleteOldSightings(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(scamCandidateSightingsInAppPublic)
      .where(lt(scamCandidateSightingsInAppPublic.seenAt, cutoff))
      .returning({ id: scamCandidateSightingsInAppPublic.id });

    return deleted.length;
  }

  async deleteOrphanedPendingRows(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(scamCandidateStateInAppPublic)
      .where(
        and(
          sql`${scamCandidateStateInAppPublic.status} IN ('claimed', 'ready_to_post')`,
          lt(scamCandidateStateInAppPublic.updatedAt, cutoff),
        ),
      )
      .returning({ key: scamCandidateStateInAppPublic.key });

    return deleted.length;
  }

  private rowToState(row: typeof scamCandidateStateInAppPublic.$inferSelect): ScamCandidateState {
    return {
      key: row.key,
      status: row.status,
      trigger: (row.trigger ?? "threshold") as ScamCandidateTrigger,
      reviewId: row.reviewId,
      triggeredByUserId: row.triggeredByUserId,
      reviewChannelId: row.reviewChannelId,
      reviewMessageId: row.reviewMessageId,
      channelCount: row.channelCount,
      guildIds: row.guildIds,
      seenByUserIds: row.seenByUserIds,
      newImageResults: row.newImageResults as StoredImageResult[] | null,
      classificationResult: row.classificationResult as StoredClassificationResult | null,
      attachmentUrls: row.attachmentUrls,
      guildNames: row.guildNames,
      claimedAt: row.claimedAt,
      updatedAt: row.updatedAt,
    };
  }
}
