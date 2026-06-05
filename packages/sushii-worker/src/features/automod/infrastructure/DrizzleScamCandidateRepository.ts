import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  scamCandidateSightingsInAppPublic,
  scamCandidateStateInAppPublic,
} from "@/infrastructure/database/schema";

import type {
  NewScamCandidateSighting,
  ScamCandidateRepository,
  ScamCandidateState,
  SightingThresholdResult,
  StoredClassificationResult,
  StoredImageResult,
} from "../domain/repositories/ScamCandidateRepository";

const CHANNEL_THRESHOLD = 5;

export class DrizzleScamCandidateRepository implements ScamCandidateRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async recordSightingAndCheckThreshold(
    sighting: NewScamCandidateSighting,
    windowMs: number,
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

      if (!counts || counts.channels < CHANNEL_THRESHOLD) {
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
    seenByUserIds: string[],
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .insert(scamCandidateStateInAppPublic)
      .values({
        key,
        status: "claimed",
        reviewId,
        triggeredByUserId,
        channelCount,
        guildIds,
        seenByUserIds,
      })
      .onConflictDoNothing()
      .returning();

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async transitionToReviewing(
    key: string,
    opts: {
      reviewChannelId: string;
      reviewMessageId: string;
      newImageResults: StoredImageResult[];
      classificationResult: StoredClassificationResult | null;
    },
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .update(scamCandidateStateInAppPublic)
      .set({
        status: "reviewing",
        reviewChannelId: opts.reviewChannelId,
        reviewMessageId: opts.reviewMessageId,
        newImageResults: opts.newImageResults,
        classificationResult: opts.classificationResult,
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

  async appendSeenUser(
    key: string,
    userId: string,
    channelCount: number,
    guildIds: string[],
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .update(scamCandidateStateInAppPublic)
      .set({
        seenByUserIds: sql`array_append(${scamCandidateStateInAppPublic.seenByUserIds}, ${userId})`,
        channelCount: sql`GREATEST(${scamCandidateStateInAppPublic.channelCount}, ${channelCount})`,
        guildIds: sql`ARRAY(SELECT DISTINCT unnest(${scamCandidateStateInAppPublic.guildIds} || ${guildIds}::text[]))`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(scamCandidateStateInAppPublic.key, key),
          sql`NOT (${userId} = ANY(${scamCandidateStateInAppPublic.seenByUserIds}))`,
          sql`${scamCandidateStateInAppPublic.status} IN ('claimed', 'reviewing')`,
        ),
      )
      .returning();

    return rows[0] ? this.rowToState(rows[0]) : null;
  }

  async resolveReview(
    reviewId: string,
    status: "ignored" | "added",
  ): Promise<ScamCandidateState | null> {
    const rows = await this.db
      .update(scamCandidateStateInAppPublic)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(scamCandidateStateInAppPublic.reviewId, reviewId),
          sql`${scamCandidateStateInAppPublic.status} NOT IN ('ignored', 'added')`,
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

  async deleteOrphanedClaimedRows(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(scamCandidateStateInAppPublic)
      .where(
        and(
          eq(scamCandidateStateInAppPublic.status, "claimed"),
          lt(scamCandidateStateInAppPublic.claimedAt, cutoff),
        ),
      )
      .returning({ key: scamCandidateStateInAppPublic.key });

    return deleted.length;
  }

  private rowToState(row: typeof scamCandidateStateInAppPublic.$inferSelect): ScamCandidateState {
    return {
      key: row.key,
      status: row.status,
      reviewId: row.reviewId,
      triggeredByUserId: row.triggeredByUserId,
      reviewChannelId: row.reviewChannelId,
      reviewMessageId: row.reviewMessageId,
      channelCount: row.channelCount,
      guildIds: row.guildIds,
      seenByUserIds: row.seenByUserIds,
      newImageResults: row.newImageResults as StoredImageResult[] | null,
      classificationResult: row.classificationResult as StoredClassificationResult | null,
      claimedAt: row.claimedAt,
      updatedAt: row.updatedAt,
    };
  }
}
