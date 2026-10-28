import { ValueType } from "@opentelemetry/api";
import type { Meter, ObservableResult } from "@opentelemetry/api";
import type { Logger } from "pino";

import type { ReasonTemplateRepository } from "@/features/moderation/reason-templates/domain/ReasonTemplateRepository";

import { moderationMeter } from "./OtelModerationMetrics";

export const REASON_TEMPLATE_STATS_TTL_MS = 5 * 60 * 1000;
export const REASON_TEMPLATE_STATS_TIMEOUT_MS = 10 * 1000;

type Stats = Awaited<ReturnType<ReasonTemplateRepository["countStats"]>>;

/**
 * Global template counts from a cached DB query. Collection never waits on
 * the DB: a stale cache starts a background refresh and the last value is
 * reported meanwhile.
 */
export class ReasonTemplateStatsGauge {
  private stats: Stats | null = null;
  private lastAttemptAt: number | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly repository: Pick<ReasonTemplateRepository, "countStats">,
    private readonly logger: Logger,
    meter: Meter = moderationMeter(),
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = REASON_TEMPLATE_STATS_TIMEOUT_MS,
  ) {
    meter
      .createObservableGauge("moderation.reason_template.guilds", {
        description: "Guilds with at least one reason template",
        valueType: ValueType.INT,
      })
      .addCallback((result) => this.observe(result, "guilds"));

    meter
      .createObservableGauge("moderation.reason_template.total", {
        description: "Reason templates across all guilds",
        valueType: ValueType.INT,
      })
      .addCallback((result) => this.observe(result, "total"));
  }

  private observe(result: ObservableResult, key: keyof Stats): void {
    this.refreshIfStale();
    // No value before the first load, so dashboards never see a false 0.
    if (this.stats) {
      result.observe(this.stats[key]);
    }
  }

  /** Resolves once a started refresh settles; for tests. */
  refreshIfStale(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }

    const now = this.now();
    if (
      this.lastAttemptAt !== null &&
      now - this.lastAttemptAt < REASON_TEMPLATE_STATS_TTL_MS
    ) {
      return Promise.resolve();
    }

    // Stamped on attempt so a DB outage queries at most once per TTL.
    this.lastAttemptAt = now;
    this.inFlight = this.countWithTimeout()
      .then((stats) => {
        this.stats = stats;
      })
      .catch((err: unknown) => {
        this.logger.warn({ err }, "Failed to refresh reason template stats");
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  // A hung query would otherwise hold inFlight forever and stop every refresh.
  private countWithTimeout(): Promise<Stats> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Reason template stats query timed out")),
        this.timeoutMs,
      );
      timer.unref();
    });

    return Promise.race([this.repository.countStats(), timeout]).finally(() =>
      clearTimeout(timer),
    );
  }
}
