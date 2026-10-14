export interface PermissionUsageCoverage {
  trackingStartedAt: Date;
  backfilledAt: Date | null;
  /** Audit log action type → start of fully observed history for that type. */
  backfillCoverage: Record<string, Date>;
}

export interface PermissionUsageCoverageRepository {
  get(guildId: string): Promise<PermissionUsageCoverage | null>;
  /**
   * Claims the one-time backfill. Returns the tracking start to backfill up
   * to, or null if it's done or another process holds a fresh claim.
   */
  claimBackfill(guildId: string, staleClaimBefore: Date): Promise<Date | null>;
  completeBackfill(
    guildId: string,
    coverage: Record<string, Date>,
  ): Promise<void>;
  releaseBackfillClaim(guildId: string): Promise<void>;
}
