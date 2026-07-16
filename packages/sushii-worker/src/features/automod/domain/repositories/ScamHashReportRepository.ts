export type ScamHashReportStatus = "pending" | "posted" | "reverted" | "dismissed";

export interface ScamHashReport {
  id: number;
  hashId: number;
  reporterId: string;
  guildId: string;
  guildName: string;
  status: ScamHashReportStatus;
  reviewMessageId: string | null;
  createdAt: Date;
}

export interface CreateScamHashReportInput {
  hashId: number;
  reporterId: string;
  guildId: string;
  guildName: string;
}

export interface ScamHashReportRepository {
  create(input: CreateScamHashReportInput): Promise<number>;
  findById(id: number): Promise<ScamHashReport | null>;
  /** An existing report for this hash/reporter pair that hasn't reached a terminal state yet. */
  findActive(hashId: number, reporterId: string): Promise<ScamHashReport | null>;
  /** Rows waiting to be posted to the review channel — polled by the owning cluster. */
  getPendingRows(): Promise<ScamHashReport[]>;
  markPosted(id: number, reviewMessageId: string): Promise<void>;
  /**
   * Atomically transitions a row from a non-terminal status to a terminal one.
   * Returns false if the row was already resolved by a concurrent click —
   * callers must not act (e.g. delete a hash) unless this returns true.
   */
  resolve(id: number, status: "reverted" | "dismissed"): Promise<boolean>;
  /** Compensates a resolve() claim when the follow-up action fails, keeping the report retryable. */
  revertToPosted(id: number): Promise<void>;
}
