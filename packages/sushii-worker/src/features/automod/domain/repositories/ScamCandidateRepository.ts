export interface StoredImageResult {
  filename: string;
  /** bigint serialized as decimal string */
  hash: string;
  closestId: number | null;
  closestLabel: string | null;
  closestDistance: number | null;
  isNew: boolean;
}

export interface StoredClassificationResult {
  isScam: boolean;
  confidence: string;
  suggestedLabel: string | null;
  reason: string;
}

export type ScamCandidateReviewStatus = "claimed" | "reviewing" | "ignored" | "added";

export interface ScamCandidateState {
  key: string;
  status: ScamCandidateReviewStatus;
  reviewId: string;
  triggeredByUserId: string;
  reviewChannelId: string | null;
  reviewMessageId: string | null;
  channelCount: number;
  guildIds: string[];
  seenByUserIds: string[];
  newImageResults: StoredImageResult[] | null;
  classificationResult: StoredClassificationResult | null;
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
    seenByUserIds: string[],
  ): Promise<ScamCandidateState | null>;

  /**
   * Transitions a claimed row to 'reviewing' and populates the nullable columns
   * that become available after the Discord message is sent.
   */
  transitionToReviewing(
    key: string,
    opts: {
      reviewChannelId: string;
      reviewMessageId: string;
      newImageResults: StoredImageResult[];
      classificationResult: StoredClassificationResult | null;
    },
  ): Promise<ScamCandidateState | null>;

  /**
   * Appends userId to seen_by_user_ids (guarded against duplicates) and updates
   * channel_count and guild_ids. Skips if status is terminal. Returns updated
   * row or null if not found.
   */
  appendSeenUser(
    key: string,
    userId: string,
    channelCount: number,
    guildIds: string[],
  ): Promise<ScamCandidateState | null>;

  /**
   * Sets status to 'ignored' or 'added' on the row identified by review_id.
   * Returns { key } on success, null if not found.
   */
  resolveReview(
    reviewId: string,
    status: "ignored" | "added",
  ): Promise<{ key: string } | null>;

  /** Looks up a state row by its review_id column. */
  getByReviewId(reviewId: string): Promise<ScamCandidateState | null>;

  /** Looks up a state row by its hash key. */
  getByHashKey(key: string): Promise<ScamCandidateState | null>;

  /** Deletes the row for the given key (used on the all-images-known path). */
  deleteByKey(key: string): Promise<void>;

  /** Deletes old sighting rows before the given cutoff. Returns deleted count. */
  deleteOldSightings(cutoff: Date): Promise<number>;

  /**
   * Deletes orphaned claimed rows stuck longer than the given timeout.
   * Returns deleted count.
   */
  deleteOrphanedClaimedRows(cutoff: Date): Promise<number>;
}
