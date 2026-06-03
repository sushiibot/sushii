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

export interface ScamCandidateReview {
  reviewId: string;
  key: string;
  userId: string;
  username: string;
  reviewChannelId: string;
  reviewMessageId: string;
  channelCount: number;
  guildIds: string[];
  imageResults: StoredImageResult[];
  classificationResult: StoredClassificationResult | null;
  createdAt: Date;
}

export interface NewScamCandidateSighting {
  key: string;
  guildId: string;
  channelId: string;
  attachmentUrls: string[];
}

export interface ScamCandidateClaimResult {
  guildIds: string[];
  channelCount: number;
  attachmentUrls: string[];
}

export interface ScamCandidateRepository {
  /**
   * Records a new sighting, then atomically checks thresholds and claims the
   * review slot for this shard if they are met.
   *
   * Returns non-null only when this call wins the claim and should proceed to
   * send a review message. Returns null when thresholds are not yet met, the
   * candidate is already being reviewed, or it has been ignored.
   */
  trackAndMaybeClaim(
    sighting: NewScamCandidateSighting,
    windowMs: number,
  ): Promise<ScamCandidateClaimResult | null>;

  /**
   * Doubles the channel threshold. Call after sending a review (reviewing stays true)
   * or after the all-known path (pass releaseReviewing=true).
   */
  updateStateAfterReview(key: string, opts: { releaseReviewing: boolean }): Promise<void>;

  /**
   * Resets reviewing=false without touching the threshold. Call when downloads fail.
   */
  releaseReview(key: string): Promise<void>;

  saveReview(review: Omit<ScamCandidateReview, "createdAt">): Promise<void>;
  getReview(reviewId: string): Promise<ScamCandidateReview | null>;

  /**
   * Deletes the review row and updates state (reviewing=false, optionally ignored=true).
   * Returns the key so the caller can react; returns null if the review was not found.
   */
  resolveReview(reviewId: string, opts?: { ignored?: boolean }): Promise<{ key: string } | null>;

  deleteOldSightings(cutoff: Date): Promise<number>;
}
