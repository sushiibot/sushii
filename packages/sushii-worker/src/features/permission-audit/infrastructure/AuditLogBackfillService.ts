import type { Guild, GuildAuditLogsEntry } from "discord.js";
import { PermissionFlagsBits, SnowflakeUtil } from "discord.js";
import type { Logger } from "pino";

import dayjs from "@/shared/domain/dayjs";

import type { PermissionUsageRecorder } from "../application/PermissionUsageRecorder";
import type { PermissionUsageCoverageRepository } from "../domain/PermissionUsageCoverageRepository";
import {
  type AuditLogEntryInput,
  TRACKED_AUDIT_LOG_ACTIONS,
} from "../domain/detectors/AuditLogUsageDetector";
import { toAuditLogEntryInput } from "./toAuditLogEntryInput";

/** Discord keeps audit log entries for 45 days. */
const AUDIT_LOG_RETENTION_DAYS = 45;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_ACTION = 5;
const STALE_CLAIM_MINUTES = 10;

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

    try {
      const windowStart = dayjs()
        .subtract(AUDIT_LOG_RETENTION_DAYS, "day")
        .toDate();
      const entries: AuditLogEntryInput[] = [];
      const coverage: Record<string, Date> = {};

      for (const action of TRACKED_AUDIT_LOG_ACTIONS) {
        const result = await this.fetchAction(
          guild,
          action,
          trackingStartedAt,
          windowStart,
        );
        entries.push(...result.entries);
        coverage[String(action)] = result.coverageStart;
      }

      await this.recorder.recordBackfill(entries);
      await this.coverageRepository.completeBackfill(guild.id, coverage);

      this.logger.info(
        { guildId: guild.id, entryCount: entries.length },
        "Permission usage backfill complete",
      );
    } catch (err) {
      await this.coverageRepository.releaseBackfillClaim(guild.id);
      throw err;
    }
  }

  /**
   * Only entries before tracking started: anything newer was already
   * recorded live and would be counted twice.
   */
  private async fetchAction(
    guild: Guild,
    action: (typeof TRACKED_AUDIT_LOG_ACTIONS)[number],
    trackingStartedAt: Date,
    windowStart: Date,
  ): Promise<{ entries: AuditLogEntryInput[]; coverageStart: Date }> {
    const entries: AuditLogEntryInput[] = [];
    let before = SnowflakeUtil.generate({
      timestamp: trackingStartedAt.getTime(),
    }).toString();

    for (let page = 0; page < MAX_PAGES_PER_ACTION; page++) {
      const logs = await guild.fetchAuditLogs({
        type: action,
        limit: PAGE_SIZE,
        before,
      });
      const pageEntries: GuildAuditLogsEntry[] = [...logs.entries.values()];
      const inWindow = pageEntries.filter(
        (entry) => entry.createdAt >= windowStart,
      );
      entries.push(
        ...inWindow.map((entry) => toAuditLogEntryInput(entry, guild.id)),
      );

      const reachedEnd =
        pageEntries.length < PAGE_SIZE || inWindow.length < pageEntries.length;
      const oldest = pageEntries.at(-1);
      if (reachedEnd || !oldest) {
        return { entries, coverageStart: windowStart };
      }

      before = oldest.id;
    }

    const oldestFetched = entries.at(-1)?.occurredAt ?? trackingStartedAt;
    return { entries, coverageStart: oldestFetched };
  }
}
