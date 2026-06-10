export interface StoredImageResult {
  filename: string;
  /** Legacy dhash bigint serialized as decimal string; absent on new entries */
  hash?: string;
  /** pHash bigint serialized as decimal string */
  phash: string;
  closestId: number | null;
  closestLabel: string | null;
  closestDistance: number | null;
  isNew: boolean;
  /** S3 key for the stored image; null if not stored or upload failed */
  s3Key?: string | null;
  /** Index into attachmentUrls; optional for backward compat with old DB rows */
  attachmentIndex?: number;
}

export type StoredClassificationResult =
  | { isScam: boolean; confidence: string; suggestedLabel: string | null; reason: string }
  | { error: string };

export type ScamCandidateReviewStatus = "claimed" | "ready_to_post" | "reviewing" | "ignored" | "added" | "reverted";
export type ScamCandidateTrigger = "threshold" | "near_miss";

export type ResolvedStatus = Extract<ScamCandidateReviewStatus, "ignored" | "added" | "reverted">;

export interface ScamCandidateState {
  key: string;
  status: ScamCandidateReviewStatus;
  trigger: ScamCandidateTrigger;
  reviewId: string;
  triggeredByUserId: string;
  reviewChannelId: string | null;
  reviewMessageId: string | null;
  channelCount: number;
  guildIds: string[];
  seenByUserIds: string[];
  newImageResults: StoredImageResult[] | null;
  classificationResult: StoredClassificationResult | null;
  attachmentUrls: string[];
  guildNames: string[];
  claimedAt: Date;
  updatedAt: Date;
}

export interface NewScamCandidateSighting {
  key: string;
  guildId: string;
  channelId: string;
  attachmentUrls: string[];
}

export interface SightingThresholdResult {
  guildIds: string[];
  channelCount: number;
  attachmentUrls: string[];
}

export interface ScamCandidateRepository {
  /**
   * Records a sighting and checks whether the channel threshold is crossed
   * within the detection window. Returns guild/channel counts if threshold is
   * met, null if not yet reached.
   */
  recordSightingAndCheckThreshold(
    sighting: NewScamCandidateSighting,
    windowMs: number,
    channelThreshold: number,
  ): Promise<SightingThresholdResult | null>;

  /**
   * Attempts to INSERT a state row with status='claimed' using ON CONFLICT DO NOTHING.
   * Returns the new row if this caller won the claim, null if a row already existed.
   */
  claimByHashKey(
    key: string,
    reviewId: string,
    triggeredByUserId: string,
    channelCount: number,
    guildIds: string[],
    trigger: ScamCandidateTrigger,
    attachmentUrls: string[],
  ): Promise<ScamCandidateState | null>;

  /**
   * Transitions a claimed row to 'ready_to_post', persisting image results and guild names
   * for the review cluster to consume.
   */
  transitionToReadyToPost(
    key: string,
    opts: {
      newImageResults: StoredImageResult[];
      guildNames: string[];
    },
  ): Promise<ScamCandidateState | null>;

  /**
   * Transitions a ready_to_post row to 'reviewing', setting review channel/message IDs and
   * the classification result (computed on the review cluster after re-downloading images).
   * Guards on WHERE status = 'ready_to_post'. Returns null if row is no longer in that status.
   */
  transitionFromReadyToPost(
    key: string,
    opts: {
      reviewChannelId: string;
      reviewMessageId: string;
      postedImageResults: StoredImageResult[];
      classificationResult: StoredClassificationResult | null;
    },
  ): Promise<ScamCandidateState | null>;

  /** Returns all rows with status='ready_to_post', ordered by claimedAt ASC. */
  getPendingPostRows(): Promise<ScamCandidateState[]>;

  /**
   * Appends userId to seen_by_user_ids (guarded against duplicates) and updates
   * channel_count and guild_ids. Only applies when status is `'claimed'`,
   * `'ready_to_post'`, or `'reviewing'`; no-op if ignored or added. Returns updated row
   * or null if not found.
   */
  appendSeenUser(
    key: string,
    userId: string,
    channelCount: number,
    guildIds: string[],
  ): Promise<ScamCandidateState | null>;

  /**
   * Sets status to 'ignored', 'added', or 'reverted' on the row identified by review_id.
   * Returns the full updated state on success, null if not found or already resolved.
   */
  resolveReview(
    reviewId: string,
    status: ResolvedStatus,
  ): Promise<ScamCandidateState | null>;

  /**
   * Transitions an 'added' row to 'reverted', guarded on status = 'added'.
   * Returns the updated state, or null if the row is not found or not in 'added' status.
   */
  revertReview(reviewId: string): Promise<ScamCandidateState | null>;

  /** Looks up a state row by its review_id column. */
  getByReviewId(reviewId: string): Promise<ScamCandidateState | null>;

  /** Looks up a state row by its hash key. */
  getByHashKey(key: string): Promise<ScamCandidateState | null>;

  /** Deletes the row for the given key (used on the all-images-known path). */
  deleteByKey(key: string): Promise<void>;

  /** Deletes old sighting rows before the given cutoff. Returns deleted count. */
  deleteOldSightings(cutoff: Date): Promise<number>;

  /**
   * Deletes orphaned rows with status IN ('claimed', 'ready_to_post') stuck longer than the given timeout.
   * Returns deleted count.
   */
  deleteOrphanedPendingRows(cutoff: Date): Promise<number>;
}
