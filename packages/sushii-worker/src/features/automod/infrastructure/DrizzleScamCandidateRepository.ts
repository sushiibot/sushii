import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  scamCandidateReviewsInAppPublic,
  scamCandidateSightingsInAppPublic,
  scamCandidateStateInAppPublic,
} from "@/infrastructure/database/schema";

import type {
  NewScamCandidateSighting,
  ScamCandidateClaimResult,
  ScamCandidateRepository,
  ScamCandidateReview,
  StoredClassificationResult,
  StoredImageResult,
} from "../domain/repositories/ScamCandidateRepository";

export class DrizzleScamCandidateRepository implements ScamCandidateRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async trackAndMaybeClaim(
    sighting: NewScamCandidateSighting,
    windowMs: number,
    guildThreshold: number,
  ): Promise<ScamCandidateClaimResult | null> {
    const { key, guildId, channelId, attachmentUrls } = sighting;
    const cutoff = new Date(Date.now() - windowMs);

    return this.db.transaction(async (tx) => {
      // Record sighting
      await tx.insert(scamCandidateSightingsInAppPublic).values({
        key,
        guildId,
        channelId,
        attachmentUrls,
      });

      // Ensure state row exists
      await tx
        .insert(scamCandidateStateInAppPublic)
        .values({ key })
        .onConflictDoNothing();

      // Count distinct guilds and channels in the window
      const [counts] = await tx
        .select({
          guilds: sql<number>`count(distinct ${scamCandidateSightingsInAppPublic.guildId})::int`,
          channels: sql<number>`count(distinct ${scamCandidateSightingsInAppPublic.channelId})::int`,
        })
        .from(scamCandidateSightingsInAppPublic)
        .where(
          and(
            eq(scamCandidateSightingsInAppPublic.key, key),
            gte(scamCandidateSightingsInAppPublic.seenAt, cutoff),
          ),
        );

      if (!counts || counts.guilds < guildThreshold) {
        return null;
      }

      // Atomically claim the review slot — only succeeds if not reviewing/ignored
      // and channel count meets the threshold
      const claimed = await tx
        .update(scamCandidateStateInAppPublic)
        .set({ reviewing: true, updatedAt: new Date() })
        .where(
          and(
            eq(scamCandidateStateInAppPublic.key, key),
            eq(scamCandidateStateInAppPublic.reviewing, false),
            eq(scamCandidateStateInAppPublic.ignored, false),
            sql`${counts.channels} >= ${scamCandidateStateInAppPublic.nextNotifyChannelThreshold}`,
          ),
        )
        .returning();

      if (claimed.length === 0) {
        return null;
      }

      // Fetch all recent sightings to build guild list and get attachment URLs
      const recentSightings = await tx
        .select({
          guildId: scamCandidateSightingsInAppPublic.guildId,
          attachmentUrls: scamCandidateSightingsInAppPublic.attachmentUrls,
          seenAt: scamCandidateSightingsInAppPublic.seenAt,
        })
        .from(scamCandidateSightingsInAppPublic)
        .where(
          and(
            eq(scamCandidateSightingsInAppPublic.key, key),
            gte(scamCandidateSightingsInAppPublic.seenAt, cutoff),
          ),
        )
        .orderBy(sql`${scamCandidateSightingsInAppPublic.seenAt} desc`);

      const guildIds = [...new Set(recentSightings.map((s) => s.guildId))];
      // Use attachment URLs from the most recent sighting
      const latestAttachmentUrls = recentSightings[0]?.attachmentUrls ?? [];

      return {
        guildIds,
        channelCount: counts.channels,
        attachmentUrls: latestAttachmentUrls,
      };
    });
  }

  async updateStateAfterReview(key: string, opts: { releaseReviewing: boolean }): Promise<void> {
    await this.db
      .update(scamCandidateStateInAppPublic)
      .set({
        reviewing: opts.releaseReviewing ? false : undefined,
        nextNotifyChannelThreshold: sql`${scamCandidateStateInAppPublic.nextNotifyChannelThreshold} * 2`,
        updatedAt: new Date(),
      })
      .where(eq(scamCandidateStateInAppPublic.key, key));
  }

  async releaseReview(key: string): Promise<void> {
    await this.db
      .update(scamCandidateStateInAppPublic)
      .set({ reviewing: false, updatedAt: new Date() })
      .where(eq(scamCandidateStateInAppPublic.key, key));
  }

  async saveReview(review: Omit<ScamCandidateReview, "createdAt">): Promise<void> {
    await this.db.insert(scamCandidateReviewsInAppPublic).values({
      reviewId: review.reviewId,
      key: review.key,
      userId: review.userId,
      username: review.username,
      reviewChannelId: review.reviewChannelId,
      reviewMessageId: review.reviewMessageId,
      channelCount: review.channelCount,
      guildIds: review.guildIds,
      newImageResults: review.imageResults,
      classificationResult: review.classificationResult,
    });
  }

  async getReview(reviewId: string): Promise<ScamCandidateReview | null> {
    const rows = await this.db
      .select()
      .from(scamCandidateReviewsInAppPublic)
      .where(eq(scamCandidateReviewsInAppPublic.reviewId, reviewId));

    if (rows.length === 0) {
      return null;
    }

    return this.rowToReview(rows[0]);
  }

  async resolveReview(
    reviewId: string,
    opts?: { ignored?: boolean },
  ): Promise<{ key: string } | null> {
    return this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(scamCandidateReviewsInAppPublic)
        .where(eq(scamCandidateReviewsInAppPublic.reviewId, reviewId))
        .returning({ key: scamCandidateReviewsInAppPublic.key });

      if (deleted.length === 0) {
        return null;
      }

      const { key } = deleted[0];

      await tx
        .update(scamCandidateStateInAppPublic)
        .set({
          reviewing: false,
          ignored: opts?.ignored ?? false,
          updatedAt: new Date(),
        })
        .where(eq(scamCandidateStateInAppPublic.key, key));

      return { key };
    });
  }

  async deleteOldSightings(cutoff: Date): Promise<number> {
    const deleted = await this.db
      .delete(scamCandidateSightingsInAppPublic)
      .where(lt(scamCandidateSightingsInAppPublic.seenAt, cutoff))
      .returning({ id: scamCandidateSightingsInAppPublic.id });

    return deleted.length;
  }

  private rowToReview(row: {
    reviewId: string;
    key: string;
    userId: string;
    username: string;
    reviewChannelId: string;
    reviewMessageId: string;
    channelCount: number;
    guildIds: string[];
    newImageResults: unknown;
    classificationResult: unknown;
    createdAt: Date;
  }): ScamCandidateReview {
    return {
      reviewId: row.reviewId,
      key: row.key,
      userId: row.userId,
      username: row.username,
      reviewChannelId: row.reviewChannelId,
      reviewMessageId: row.reviewMessageId,
      channelCount: row.channelCount,
      guildIds: row.guildIds,
      imageResults: row.newImageResults as StoredImageResult[],
      classificationResult: row.classificationResult as StoredClassificationResult | null,
      createdAt: row.createdAt,
    };
  }
}
