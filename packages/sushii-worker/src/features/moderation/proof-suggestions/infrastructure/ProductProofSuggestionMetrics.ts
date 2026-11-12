import type { Logger } from "pino";

import type {
  ProductEventInput,
  ProductEventTracker,
} from "@/features/product-analytics/domain/ProductEvent";

import type {
  ProofSuggestionMetrics,
  SuggestionActor,
  SuggestionAddOutcome,
  SuggestionSkipReason,
  SuggestionSurface,
  SuggestionUndoOutcome,
} from "../domain/ProofSuggestionMetrics";

export class ProductProofSuggestionMetrics implements ProofSuggestionMetrics {
  constructor(
    private readonly metrics: ProofSuggestionMetrics,
    private readonly events: ProductEventTracker,
    private readonly logger: Logger,
  ) {}

  recordShown(surface: SuggestionSurface, actor: SuggestionActor): void {
    this.metrics.recordShown(surface, actor);
    this.track({
      name: "proof_suggestion.shown",
      ...actor,
      props: { surface },
    });
  }

  recordAdded(
    surface: SuggestionSurface,
    outcome: SuggestionAddOutcome,
    actor: SuggestionActor,
    links: number,
  ): void {
    this.metrics.recordAdded(surface, outcome, actor, links);
    this.track({
      name: "proof_suggestion.added",
      ...actor,
      // No links prop when nothing resolved, so "1" always means one saved link.
      props:
        links > 0
          ? {
              surface,
              outcome,
              links: links === 1 ? "1" : links <= 5 ? "2-5" : "6+",
            }
          : { surface, outcome },
    });
  }

  recordUndone(outcome: SuggestionUndoOutcome, actor: SuggestionActor): void {
    this.metrics.recordUndone(outcome, actor);
    this.track({
      name: "proof_suggestion.undone",
      ...actor,
      props: { outcome },
    });
  }

  recordSkipped(reason: SuggestionSkipReason, count: number): void {
    this.metrics.recordSkipped(reason, count);
  }

  recordRenderMs(ms: number): void {
    this.metrics.recordRenderMs(ms);
  }

  private track(event: ProductEventInput): void {
    try {
      this.events.track(event);
    } catch (err) {
      this.logger.warn({ err }, "Failed to track suggested proof event");
    }
  }
}
