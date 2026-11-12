import { describe, expect, mock, test } from "bun:test";
import pino from "pino";

import { ProductAnalyticsService } from "@/features/product-analytics/application/ProductAnalyticsService";
import type { ProductAnalyticsRepository } from "@/features/product-analytics/domain/ProductAnalyticsRepository";
import type { ProductEventInput } from "@/features/product-analytics/domain/ProductEvent";

import { NOOP_PROOF_SUGGESTION_METRICS } from "../domain/ProofSuggestionMetrics";
import { ProductProofSuggestionMetrics } from "./ProductProofSuggestionMetrics";

const actor = { userId: "123", guildId: "456" };
const logger = pino({ level: "silent" });
const surfaces = ["response", "review", "modal", "modlog"] as const;
const addOutcomes = [
  "ok",
  "partial",
  "nothing_linked",
  "already_added",
  "changed",
  "case_not_found",
  "failed",
] as const;
const undoOutcomes = ["ok", "gone", "not_allowed", "failed"] as const;

function setup(track = mock((_event: ProductEventInput) => undefined)) {
  const metrics = {
    recordShown: mock(),
    recordAdded: mock(),
    recordUndone: mock(),
    recordSkipped: mock(),
    recordRenderMs: mock(),
  };
  return {
    track,
    metrics,
    adapter: new ProductProofSuggestionMetrics(metrics, { track }, logger),
  };
}

describe("ProductProofSuggestionMetrics", () => {
  for (const surface of surfaces) {
    test(`shown on ${surface}`, () => {
      const { adapter, track, metrics } = setup();
      adapter.recordShown(surface, actor);
      expect(metrics.recordShown).toHaveBeenCalledWith(surface, actor);
      expect(track.mock.calls).toEqual([
        [{ name: "proof_suggestion.shown", ...actor, props: { surface } }],
      ]);
    });

    for (const outcome of addOutcomes) {
      test(`added on ${surface}: ${outcome}`, () => {
        for (const [links, bucket] of [
          [0, null],
          [1, "1"],
          [2, "2-5"],
          [5, "2-5"],
          [6, "6+"],
          [100, "6+"],
        ] as const) {
          const { adapter, track, metrics } = setup();
          adapter.recordAdded(surface, outcome, actor, links);
          expect(metrics.recordAdded).toHaveBeenCalledWith(
            surface,
            outcome,
            actor,
            links,
          );
          expect(track.mock.calls).toEqual([
            [
              {
                name: "proof_suggestion.added",
                ...actor,
                props:
                  bucket === null
                    ? { surface, outcome }
                    : { surface, outcome, links: bucket },
              },
            ],
          ]);
        }
      });
    }
  }

  for (const outcome of undoOutcomes) {
    test(`undone: ${outcome}`, () => {
      const { adapter, track, metrics } = setup();
      adapter.recordUndone(outcome, actor);
      expect(metrics.recordUndone).toHaveBeenCalledWith(outcome, actor);
      expect(track.mock.calls).toEqual([
        [{ name: "proof_suggestion.undone", ...actor, props: { outcome } }],
      ]);
    });
  }

  test("skipped and render timing only record metrics", () => {
    const { adapter, track, metrics } = setup();
    adapter.recordSkipped("pending", 3);
    adapter.recordRenderMs(20);
    expect(metrics.recordSkipped).toHaveBeenCalledWith("pending", 3);
    expect(metrics.recordRenderMs).toHaveBeenCalledWith(20);
    expect(track).not.toHaveBeenCalled();
  });

  test("tracker throws do not escape or prevent metrics", () => {
    const { adapter, metrics } = setup(
      mock(() => {
        throw new Error("unavailable");
      }),
    );
    expect(() => adapter.recordShown("modal", actor)).not.toThrow();
    expect(() => adapter.recordAdded("response", "ok", actor, 2)).not.toThrow();
    expect(() => adapter.recordUndone("ok", actor)).not.toThrow();
    expect(metrics.recordShown).toHaveBeenCalledTimes(1);
    expect(metrics.recordAdded).toHaveBeenCalledTimes(1);
    expect(metrics.recordUndone).toHaveBeenCalledTimes(1);
  });

  test("pending and rejected analytics writes do not delay the caller", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, rejectWrite) => {
      reject = rejectWrite;
    });
    const insert = mock(() => pending);
    const repository = { insert } as unknown as ProductAnalyticsRepository;
    const tracker = new ProductAnalyticsService(repository, "test-key", logger);
    const adapter = new ProductProofSuggestionMetrics(
      NOOP_PROOF_SUGGESTION_METRICS,
      tracker,
      logger,
    );
    expect(adapter.recordShown("response", actor)).toBeUndefined();
    expect(adapter.recordAdded("review", "partial", actor, 6)).toBeUndefined();
    expect(adapter.recordUndone("failed", actor)).toBeUndefined();
    expect(insert).toHaveBeenCalledTimes(3);
    reject(new Error("database unavailable"));
    await pending.catch(() => undefined);
    await Promise.resolve();
  });
});
