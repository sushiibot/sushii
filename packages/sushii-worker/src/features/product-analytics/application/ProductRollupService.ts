import type { Logger } from "pino";

import type { ProductAnalyticsRepository } from "../domain/ProductAnalyticsRepository";
import {
  MAX_RETENTION_WEEKS,
  OLDEST_ROW_ALERT_DAYS,
  WATERMARK_LAG_ALERT_DAYS,
  addDays,
  addWeeks,
  firstCompleteWeek,
  isReportedRetention,
  rawCutoff,
  startOfWeek,
  suppressRetention,
  suppressUsage,
} from "../domain/rollup";

function later(a: Date, b: Date): Date {
  return a.getTime() > b.getTime() ? a : b;
}

export class ProductRollupService {
  constructor(
    private readonly repository: ProductAnalyticsRepository,
    private readonly logger: Logger,
  ) {}

  async run(now: Date): Promise<void> {
    // Deletion goes first so a stuck rollup can't break the 90-day limit; the rollup skips incomplete weeks.
    try {
      await this.deleteExpired(now);
    } finally {
      await this.rollUp(now);
    }
  }

  private rollUp(now: Date): Promise<void> {
    return this.repository.withRollupLock(async (tx) => {
      const currentWeek = startOfWeek(now);
      const complete = firstCompleteWeek(now);
      const oldest = await tx.oldestEventAt();
      const watermark = (await tx.getWatermark()) ?? startOfWeek(oldest ?? now);

      const lagDays =
        (currentWeek.getTime() - watermark.getTime()) / (24 * 60 * 60 * 1000);
      if (lagDays > WATERMARK_LAG_ALERT_DAYS) {
        this.logger.error(
          { watermark, lagDays },
          "Product rollup is behind; retention cells will be lost if it stays behind",
        );
      }

      const usageFrom = later(watermark, complete);
      const usage = (await tx.usageCounts(usageFrom, currentWeek))
        .map(suppressUsage)
        .filter((cell) => cell !== null);
      await tx.upsertUsage(usage);

      const cohortsFrom = later(
        addWeeks(watermark, -MAX_RETENTION_WEEKS),
        complete,
      );
      const retention = (await tx.retentionCounts(cohortsFrom, currentWeek))
        .filter(isReportedRetention)
        .map(suppressRetention);
      await tx.upsertRetention(retention);

      await tx.setWatermark(currentWeek);
    });
  }

  private async deleteExpired(now: Date): Promise<void> {
    const cutoff = rawCutoff(now);
    const deleted = await this.repository.deleteOlderThan(cutoff);
    const oldest = await this.repository.oldestEventAt();
    this.logger.info({ deleted, cutoff, oldest }, "Deleted old product events");

    if (oldest && oldest < addDays(now, -OLDEST_ROW_ALERT_DAYS)) {
      this.logger.error({ oldest }, "Product events are past the 90-day limit");
    }
  }
}
