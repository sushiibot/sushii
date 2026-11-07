/** Told when proof is added to or removed from cases, so open views can refresh their counts. */
export interface ProofChangeListener {
  /** Best effort and never throws; the caller doesn't wait on it. */
  proofChanged(guildId: string, caseIds: string[]): void;
}
