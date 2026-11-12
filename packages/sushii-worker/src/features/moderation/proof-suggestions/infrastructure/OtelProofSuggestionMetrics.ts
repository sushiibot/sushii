import { ValueType } from "@opentelemetry/api";
import type { Counter, Histogram, Meter } from "@opentelemetry/api";

import { moderationMeter } from "@/features/moderation/shared/infrastructure/metrics/OtelModerationMetrics";

import type {
  ProofSuggestionMetrics,
  SuggestionAddOutcome,
  SuggestionSkipReason,
  SuggestionSurface,
  SuggestionUndoOutcome,
} from "../domain/ProofSuggestionMetrics";

/** No guild or user attributes: they would multiply series per guild. */
export class OtelProofSuggestionMetrics implements ProofSuggestionMetrics {
  private readonly shown: Counter;
  private readonly added: Counter;
  private readonly undone: Counter;
  private readonly skipped: Counter;
  private readonly renderMs: Histogram;

  constructor(meter: Meter = moderationMeter()) {
    this.shown = meter.createCounter("moderation.proof_suggestions.shown", {
      description: "Suggested proof shown to moderators, by surface",
      valueType: ValueType.INT,
    });
    this.added = meter.createCounter("moderation.proof_suggestions.added", {
      description: "Attempts to add suggested proof, by surface and outcome",
      valueType: ValueType.INT,
    });
    this.undone = meter.createCounter("moderation.proof_suggestions.undone", {
      description: "Attempts to undo added suggested proof, by outcome",
      valueType: ValueType.INT,
    });
    this.skipped = meter.createCounter("moderation.proof_suggestions.skipped", {
      description: "Suggested messages left out of saved proof, by reason",
      valueType: ValueType.INT,
    });
    this.renderMs = meter.createHistogram(
      "moderation.proof_suggestions.render_ms",
      {
        description: "Time to render one suggested proof preview",
        unit: "ms",
        valueType: ValueType.DOUBLE,
      },
    );
  }

  recordShown(surface: SuggestionSurface): void {
    this.shown.add(1, { surface });
  }

  recordAdded(surface: SuggestionSurface, outcome: SuggestionAddOutcome): void {
    this.added.add(1, { surface, outcome });
  }

  recordUndone(outcome: SuggestionUndoOutcome): void {
    this.undone.add(1, { outcome });
  }

  recordSkipped(reason: SuggestionSkipReason, count: number): void {
    if (count > 0) {
      this.skipped.add(count, { reason });
    }
  }

  recordRenderMs(ms: number): void {
    this.renderMs.record(ms);
  }
}
