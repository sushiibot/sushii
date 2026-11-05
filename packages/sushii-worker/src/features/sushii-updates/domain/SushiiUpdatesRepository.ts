export interface BackfillCandidate {
  guildId: string;
  channelId: string;
}

export interface SushiiUpdatesRepository {
  /** Upserts, so it also works for a guild without a config row yet. */
  setWebhookId(guildId: string, webhookId: string | null): Promise<void>;
  /** Records an explicit choice so the backfill never overrides it. */
  markDecided(guildId: string): Promise<void>;
  /** Guilds with an enabled notifications channel that were never followed or offered. */
  findBackfillCandidates(): Promise<BackfillCandidate[]>;
  /**
   * Atomically stamps the guild as backfilled. Returns its notifications
   * channel when this caller won the claim, or null.
   */
  claimBackfill(guildId: string): Promise<string | null>;
}
