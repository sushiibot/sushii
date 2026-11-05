import type { DeliveryOutcome, RelayTarget, UpdatePost } from "./UpdatePost";

export interface DeliveryResult {
  status: DeliveryOutcome;
  messageId?: string;
  errorCode?: string;
}

export type ClaimResult =
  | { kind: "claimed"; attempt: number }
  | { kind: "taken" }
  /** Another process deleted the post. */
  | { kind: "post_deleted" };

export interface SushiiUpdatesRepository {
  /** False when the post was already stored. */
  savePost(post: UpdatePost): Promise<boolean>;
  deletePost(messageId: string): Promise<void>;
  /** Deliveries go with their posts. Returns the number of posts removed. */
  deletePostsBefore(cutoff: Date): Promise<number>;
  /** Oldest first. */
  findPostsSince(since: Date): Promise<UpdatePost[]>;
  /**
   * Guilds among `guildIds` with sushii notifications and sushii updates on
   * and no delivery for the post, or a retry whose backoff has passed.
   */
  findPendingTargets(
    postId: string,
    guildIds: string[],
  ): Promise<RelayTarget[]>;
  /** Inserting the delivery row (or taking a retry row) is the claim, so only one process sends. */
  claimDelivery(postId: string, guildId: string): Promise<ClaimResult>;
  /** Drops a claim without counting it as an attempt. */
  releaseClaim(postId: string, guildId: string): Promise<void>;
  completeDelivery(
    postId: string,
    guildId: string,
    result: DeliveryResult,
  ): Promise<void>;
  /** True only the first time for a guild; kept apart from deliveries so post cleanup never resets it. */
  claimIntro(guildId: string): Promise<boolean>;
  /** Claims last touched between `from` and `to`; older ones are left out so one crash doesn't alert for a month. */
  countStuckClaims(from: Date, to: Date): Promise<number>;
}
