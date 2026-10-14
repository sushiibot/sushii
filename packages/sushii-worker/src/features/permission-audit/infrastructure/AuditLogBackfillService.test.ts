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
import { AuditLogBackfillService } from "./AuditLogBackfillService";

const GUILD_ID = "200000000000000002";
const DAY_MS = 24 * 60 * 60 * 1000;

function entry(
  daysAgo: number,
  action: AuditLogEvent = AuditLogEvent.MemberBanAdd,
): GuildAuditLogsEntry {
  const createdAt = new Date(Date.now() - daysAgo * DAY_MS);
  return {
    id: SnowflakeUtil.generate({ timestamp: createdAt.getTime() }).toString(),
    action,
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

  function fullPage(
    action: AuditLogEvent,
    startDaysAgo: number,
  ): ReturnType<typeof page> {
    return page(
      Array.from({ length: 100 }, (_, i) =>
        entry(startDaysAgo + i / 1000, action),
      ),
    );
  }

  function coverageFor(action: AuditLogEvent): Date | undefined {
    const [, coverageByAction] = coverage.completeBackfill.mock.calls[0] as [
      string,
      Record<string, Date>,
    ];
    return coverageByAction[String(action)];
  }

  test("a quiet server needs one unfiltered fetch", async () => {
    await service.run(guild());

    expect(fetchAuditLogs).toHaveBeenCalledTimes(1);
    const [options] = fetchAuditLogs.mock.calls[0] as [
      { type?: AuditLogEvent; before: string },
    ];
    expect(options.type).toBeUndefined();
    expect(SnowflakeUtil.timestampFrom(options.before)).toBe(
      trackingStartedAt.getTime(),
    );
    expect(
      Date.now() - (coverageFor(AuditLogEvent.MemberBanAdd)?.getTime() ?? 0),
    ).toBeGreaterThan(44 * DAY_MS);
  });

  test("keeps only tracked entries inside the 45-day window", async () => {
    fetchAuditLogs.mockImplementation(() =>
      Promise.resolve(
        page([entry(1), entry(2, AuditLogEvent.InviteCreate), entry(50)]),
      ),
    );

    await service.run(guild());

    const [entries] = recordBackfill.mock.calls[0] as [unknown[]];
    expect(entries).toHaveLength(1);
  });

  test("writes each page as it arrives", async () => {
    let call = 0;
    fetchAuditLogs.mockImplementation(() => {
      call++;
      return Promise.resolve(
        call === 1 ? fullPage(AuditLogEvent.MemberBanAdd, 1) : page([entry(3)]),
      );
    });

    await service.run(guild());

    expect(recordBackfill).toHaveBeenCalledTimes(2);
    expect(fetchAuditLogs).toHaveBeenCalledTimes(2);
  });

  test("partial coverage when the page cap is hit", async () => {
    let call = 0;
    fetchAuditLogs.mockImplementation(() => {
      call++;
      return Promise.resolve(fullPage(AuditLogEvent.InviteCreate, call));
    });

    await service.run(guild());

    expect(fetchAuditLogs).toHaveBeenCalledTimes(10);

    const daysCovered =
      (Date.now() - (coverageFor(AuditLogEvent.MemberBanAdd)?.getTime() ?? 0)) /
      DAY_MS;
    expect(daysCovered).toBeGreaterThan(10);
    expect(daysCovered).toBeLessThan(11);
  });

  test("releases the claim when nothing was written", async () => {
    fetchAuditLogs.mockImplementation(() =>
      Promise.reject(new Error("Missing Access")),
    );

    await expect(service.run(guild())).rejects.toThrow("Missing Access");

    expect(coverage.releaseBackfillClaim).toHaveBeenCalledWith(GUILD_ID);
    expect(coverage.completeBackfill).not.toHaveBeenCalled();
  });

  test("keeps partial coverage when a later page fails", async () => {
    let call = 0;
    fetchAuditLogs.mockImplementation(() => {
      call++;
      return call === 1
        ? Promise.resolve(fullPage(AuditLogEvent.MemberBanAdd, 1))
        : Promise.reject(new Error("Missing Access"));
    });

    await service.run(guild());

    expect(coverage.releaseBackfillClaim).not.toHaveBeenCalled();
    const daysCovered =
      (Date.now() - (coverageFor(AuditLogEvent.MemberBanAdd)?.getTime() ?? 0)) /
      DAY_MS;
    expect(daysCovered).toBeGreaterThan(1);
    expect(daysCovered).toBeLessThan(2);
  });

  test("startIfNeeded swallows failures", async () => {
    coverage.claimBackfill.mockImplementation(() =>
      Promise.reject(new Error("db down")),
    );

    expect(() => service.startIfNeeded(guild())).not.toThrow();
    await Bun.sleep(0);
  });
});
