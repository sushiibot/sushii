/** Told when proof lands on cases, so open views can refresh their counts. */
export interface ProofChangeListener {
  /** Best effort and never throws; the caller doesn't wait on it. */
  proofAdded(guildId: string, caseIds: string[]): void;
}
