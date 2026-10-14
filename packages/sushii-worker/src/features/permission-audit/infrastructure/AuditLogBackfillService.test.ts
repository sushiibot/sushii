import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AuditLogEvent,
  Collection,
  type Guild,
  type GuildAuditLogsEntry,
  SnowflakeUtil,
} from "discord.js";
import pino from "pino";

import type { PermissionUsageRecorder } from "../application/PermissionUsageRecorder";
import type { PermissionUsageCoverageRepository } from "../domain/PermissionUsageCoverageRepository";
import { TRACKED_AUDIT_LOG_ACTIONS } from "../domain/detectors/AuditLogUsageDetector";
import { AuditLogBackfillService } from "./AuditLogBackfillService";

const GUILD_ID = "200000000000000002";
const DAY_MS = 24 * 60 * 60 * 1000;

function entry(daysAgo: number): GuildAuditLogsEntry {
  const createdAt = new Date(Date.now() - daysAgo * DAY_MS);
  return {
    id: SnowflakeUtil.generate({ timestamp: createdAt.getTime() }).toString(),
    action: AuditLogEvent.MemberBanAdd,
    executorId: "300000000000000003",
    targetId: "400000000000000004",
    target: null,
    extra: null,
    changes: [],
    createdAt,
  } as unknown as GuildAuditLogsEntry;
}

function page(entries: GuildAuditLogsEntry[]) {
  return {
    entries: new Collection(entries.map((e) => [e.id, e])),
  };
}

describe("AuditLogBackfillService", () => {
  let coverage: {
    claimBackfill: ReturnType<typeof mock>;
    completeBackfill: ReturnType<typeof mock>;
    releaseBackfillClaim: ReturnType<typeof mock>;
  };
  let recordBackfill: ReturnType<typeof mock>;
  let fetchAuditLogs: ReturnType<typeof mock>;
  let canViewAuditLog: boolean;
  let service: AuditLogBackfillService;
  const trackingStartedAt = new Date();

  function guild(): Guild {
    return {
      id: GUILD_ID,
      members: { me: { permissions: { has: () => canViewAuditLog } } },
      fetchAuditLogs,
    } as unknown as Guild;
  }

  beforeEach(() => {
    canViewAuditLog = true;
    coverage = {
      claimBackfill: mock(() => Promise.resolve(trackingStartedAt)),
      completeBackfill: mock(() => Promise.resolve()),
      releaseBackfillClaim: mock(() => Promise.resolve()),
    };
    recordBackfill = mock(() => Promise.resolve());
    fetchAuditLogs = mock(() => Promise.resolve(page([])));
    service = new AuditLogBackfillService(
      coverage as unknown as PermissionUsageCoverageRepository,
      { recordBackfill } as unknown as PermissionUsageRecorder,
      pino({ level: "silent" }),
    );
  });

  test("does nothing without View Audit Log", async () => {
    canViewAuditLog = false;

    await service.run(guild());

    expect(coverage.claimBackfill).not.toHaveBeenCalled();
    expect(fetchAuditLogs).not.toHaveBeenCalled();
  });

  test("does nothing when the claim is taken", async () => {
    coverage.claimBackfill.mockImplementation(() => Promise.resolve(null));

    await service.run(guild());

    expect(fetchAuditLogs).not.toHaveBeenCalled();
  });

  test("fetches every tracked action before tracking started", async () => {
    await service.run(guild());

    expect(fetchAuditLogs).toHaveBeenCalledTimes(
      TRACKED_AUDIT_LOG_ACTIONS.length,
    );
    for (const [options] of fetchAuditLogs.mock.calls as [
      { before: string },
    ][]) {
      expect(SnowflakeUtil.timestampFrom(options.before)).toBe(
        trackingStartedAt.getTime(),
      );
    }
  });

  test("keeps only entries inside the 45-day window", async () => {
    fetchAuditLogs.mockImplementation((options: { type: AuditLogEvent }) =>
      Promise.resolve(
        options.type === AuditLogEvent.MemberBanAdd
          ? page([entry(1), entry(50)])
          : page([]),
      ),
    );

    await service.run(guild());

    const [entries] = recordBackfill.mock.calls[0] as [unknown[]];
    expect(entries).toHaveLength(1);
  });

  test("full coverage when a type runs out of entries", async () => {
    await service.run(guild());

    const [, coverageByAction] = coverage.completeBackfill.mock.calls[0] as [
      string,
      Record<string, Date>,
    ];
    const banCoverage = coverageByAction[String(AuditLogEvent.MemberBanAdd)];
    expect(Date.now() - (banCoverage?.getTime() ?? 0)).toBeGreaterThan(
      44 * DAY_MS,
    );
  });

  test("partial coverage when the page cap is hit", async () => {
    let call = 0;
    fetchAuditLogs.mockImplementation((options: { type: AuditLogEvent }) => {
      if (options.type !== AuditLogEvent.MemberBanAdd) {
        return Promise.resolve(page([]));
      }
      call++;
      const full = Array.from({ length: 100 }, (_, i) =>
        entry(call + i / 1000),
      );
      return Promise.resolve(page(full));
    });

    await service.run(guild());

    const [, coverageByAction] = coverage.completeBackfill.mock.calls[0] as [
      string,
      Record<string, Date>,
    ];
    const banCoverage = coverageByAction[String(AuditLogEvent.MemberBanAdd)];
    const daysCovered = (Date.now() - (banCoverage?.getTime() ?? 0)) / DAY_MS;
    expect(daysCovered).toBeLessThan(10);
  });

  test("releases the claim when fetching fails", async () => {
    fetchAuditLogs.mockImplementation(() =>
      Promise.reject(new Error("Missing Access")),
    );

    await expect(service.run(guild())).rejects.toThrow("Missing Access");

    expect(coverage.releaseBackfillClaim).toHaveBeenCalledWith(GUILD_ID);
    expect(coverage.completeBackfill).not.toHaveBeenCalled();
  });

  test("startIfNeeded swallows failures", async () => {
    coverage.claimBackfill.mockImplementation(() =>
      Promise.reject(new Error("db down")),
    );

    expect(() => service.startIfNeeded(guild())).not.toThrow();
    await Bun.sleep(0);
  });
});
