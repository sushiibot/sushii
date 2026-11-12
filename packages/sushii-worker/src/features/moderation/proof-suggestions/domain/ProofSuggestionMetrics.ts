export type SuggestionSurface = "response" | "review" | "modal" | "modlog";

export type SuggestionAddOutcome =
  | "ok"
  | "partial"
  | "nothing_linked"
  | "already_added"
  | "changed"
  | "case_not_found"
  | "failed";

export type SuggestionUndoOutcome = "ok" | "gone" | "not_allowed" | "failed";

export type SuggestionSkipReason =
  | "pending"
  | "deleted_not_logged"
  | "unchecked";

export interface SuggestionActor {
  userId: string;
  guildId: string;
}

/** Recording is synchronous and must never throw into the feature. */
export interface ProofSuggestionMetrics {
  recordShown(surface: SuggestionSurface, actor: SuggestionActor): void;
  recordAdded(
    surface: SuggestionSurface,
    outcome: SuggestionAddOutcome,
    actor: SuggestionActor,
    links: number,
  ): void;
  recordUndone(outcome: SuggestionUndoOutcome, actor: SuggestionActor): void;
  recordSkipped(reason: SuggestionSkipReason, count: number): void;
  recordRenderMs(ms: number): void;
}

export const NOOP_PROOF_SUGGESTION_METRICS: ProofSuggestionMetrics = {
  recordShown: () => undefined,
  recordAdded: () => undefined,
  recordUndone: () => undefined,
  recordSkipped: () => undefined,
  recordRenderMs: () => undefined,
};
