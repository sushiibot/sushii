import type { Guild, GuildAuditLogsEntry } from "discord.js";
import {
  type AuditLogEvent,
  PermissionFlagsBits,
  SnowflakeUtil,
} from "discord.js";
import type { Logger } from "pino";

import dayjs from "@/shared/domain/dayjs";

import type { PermissionUsageRecorder } from "../application/PermissionUsageRecorder";
import type { PermissionUsageCoverageRepository } from "../domain/PermissionUsageCoverageRepository";
import { TRACKED_AUDIT_LOG_ACTIONS } from "../domain/detectors/AuditLogUsageDetector";
import { toAuditLogEntryInput } from "./toAuditLogEntryInput";

/** Discord keeps audit log entries for 45 days. */
const AUDIT_LOG_RETENTION_DAYS = 45;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const STALE_CLAIM_MINUTES = 10;
const TRACKED_ACTION_SET: ReadonlySet<AuditLogEvent> = new Set(
  TRACKED_AUDIT_LOG_ACTIONS,
);

export class AuditLogBackfillService {
  constructor(
    private readonly coverageRepository: PermissionUsageCoverageRepository,
    private readonly recorder: PermissionUsageRecorder,
    private readonly logger: Logger,
  ) {}

  /** Fire-and-forget: never awaited by the command, never throws. */
  startIfNeeded(guild: Guild): void {
    void this.run(guild).catch((err: unknown) => {
      this.logger.error(
        { err, guildId: guild.id },
        "Permission usage backfill failed",
      );
    });
  }

  async run(guild: Guild): Promise<void> {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      return;
    }

    const staleClaimBefore = dayjs()
      .subtract(STALE_CLAIM_MINUTES, "minute")
      .toDate();
    const trackingStartedAt = await this.coverageRepository.claimBackfill(
      guild.id,
      staleClaimBefore,
    );
    if (!trackingStartedAt) {
      return;
    }

    const windowStart = dayjs()
      .subtract(AUDIT_LOG_RETENTION_DAYS, "day")
      .toDate();
    const progress: BackfillProgress = {
      coverage: Object.fromEntries(
        TRACKED_AUDIT_LOG_ACTIONS.map((action) => [
          String(action),
          trackingStartedAt,
        ]),
      ),
      pagesWritten: 0,
      entryCount: 0,
    };

    try {
      await this.backfill(guild, trackingStartedAt, windowStart, progress);
    } catch (err) {
      // Written pages can't be rewritten on retry since use_count is
      // additive, so keep what was saved as partial coverage instead.
      if (progress.pagesWritten === 0) {
        await this.coverageRepository.releaseBackfillClaim(guild.id);
        throw err;
      }

      this.logger.warn(
        { err, guildId: guild.id, entryCount: progress.entryCount },
        "Permission usage backfill stopped early, keeping partial coverage",
      );
    }

    await this.coverageRepository.completeBackfill(guild.id, progress.coverage);
    this.logger.info(
      {
        guildId: guild.id,
        entryCount: progress.entryCount,
        pagesWritten: progress.pagesWritten,
      },
      "Permission usage backfill complete",
    );
  }

  /**
   * Unfiltered, since the endpoint takes only one action type per request.
   * Busy servers that hit the page cap get partial coverage instead.
   */
  private async backfill(
    guild: Guild,
    trackingStartedAt: Date,
    windowStart: Date,
    progress: BackfillProgress,
  ): Promise<void> {
    // Anything at or after tracking start was already recorded live.
    let cursor = SnowflakeUtil.generate({
      timestamp: trackingStartedAt.getTime(),
    }).toString();

    for (let page = 0; page < MAX_PAGES; page++) {
      const logs = await guild.fetchAuditLogs({
        limit: PAGE_SIZE,
        before: cursor,
      });
      const pageEntries: GuildAuditLogsEntry[] = [...logs.entries.values()];
      const inWindow = pageEntries.filter(
        (entry) => entry.createdAt >= windowStart,
      );
      const tracked = inWindow
        .filter((entry) => TRACKED_ACTION_SET.has(entry.action))
        .map((entry) => toAuditLogEntryInput(entry, guild.id));

      if (tracked.length > 0) {
        await this.recorder.recordBackfill(tracked);
        progress.pagesWritten++;
        progress.entryCount += tracked.length;
      }

      const oldest = pageEntries.at(-1);
      if (
        !oldest ||
        pageEntries.length < PAGE_SIZE ||
        inWindow.length < pageEntries.length
      ) {
        setCoverage(progress, windowStart);
        return;
      }

      setCoverage(progress, oldest.createdAt);
      cursor = oldest.id;
    }
  }
}

function setCoverage(progress: BackfillProgress, coveredFrom: Date): void {
  for (const action of TRACKED_AUDIT_LOG_ACTIONS) {
    progress.coverage[String(action)] = coveredFrom;
  }
}

interface BackfillProgress {
  coverage: Record<string, Date>;
  pagesWritten: number;
  entryCount: number;
}
