import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";

import type {
  IpGrabberDomain,
  IpGrabberRepository,
} from "../domain/IpGrabberRepository";
import type { IpGrabberMetrics } from "../infrastructure/IpGrabberMetrics";
import type { CheckResult, IpGrabberDetector } from "./IpGrabberDetector";
import {
  IpGrabberMaintenanceService,
  parseGrabifyDomains,
} from "./IpGrabberMaintenanceService";

const NOW = new Date("2026-11-02T12:00:00Z");

describe("parseGrabifyDomains", () => {
  test("keeps unexpired and never-expiring domains", () => {
    expect(
      parseGrabifyDomains(
        [
          { Domain: "Live.icu", Expiry: "2027-04-12T00:00:00.000000Z" },
          { Domain: "old.icu", Expiry: "2026-04-12T00:00:00.000000Z" },
          { Domain: "grabify.link", Expiry: null },
          { Domain: "bad", Expiry: null },
          { Domain: 3, Expiry: null },
          { Domain: "weird.icu", Expiry: "not a date" },
        ],
        NOW,
      ),
    ).toEqual(["live.icu", "grabify.link"]);
  });

  test("rejects a non-array payload", () => {
    expect(parseGrabifyDomains({ error: "nope" }, NOW)).toBeNull();
  });
});

function domain(hostname: string): IpGrabberDomain {
  return {
    hostname,
    provider: "grabify",
    source: "discovered",
    status: "active",
    firstSeenGuildId: null,
    firstSeenGuildName: null,
    firstSeenChannelId: null,
    firstSeenChannelName: null,
    reviewStatus: "posted",
    reviewMessageId: null,
    failedChecks: 0,
    createdAt: NOW,
  };
}

function setup(results: Record<string, CheckResult>, payload: unknown = []) {
  const repository = {
    findDomain: mock(async (h: string) => {
      if (h === "known.icu") {
        return domain(h);
      }
      return h === "stale.icu"
        ? { ...domain(h), status: "stale" as const }
        : null;
    }),
    addDomain: mock(async () => true),
    listDomainsToRecheck: mock(async () => [
      domain("a.icu"),
      domain("b.icu"),
      domain("c.icu"),
    ]),
    recordCheck: mock(async () => undefined),
  } as unknown as IpGrabberRepository;
  const detector = {
    check: mock(
      async (_p: string, h: string) => results[h] ?? { kind: "no_match" },
    ),
  } as unknown as IpGrabberDetector;
  const counter = { add: mock(() => undefined) };
  const metrics = {
    checkCounter: counter,
    discoveredCounter: counter,
    endpointFetchCounter: counter,
  } as unknown as IpGrabberMetrics;
  const logger = {
    info: mock(() => undefined),
    warn: mock(() => undefined),
  } as unknown as Logger;
  const fetchFn = mock(async () =>
    Response.json(payload),
  ) as unknown as typeof fetch;

  return {
    service: new IpGrabberMaintenanceService(
      repository,
      detector,
      metrics,
      logger,
      fetchFn,
    ),
    repository,
    detector,
  };
}

describe("IpGrabberMaintenanceService", () => {
  test("adds only new endpoint domains that pass the DNS check", async () => {
    const { service, repository, detector } = setup(
      {
        "new.icu": { kind: "match", hostname: "new.icu" },
        "stale.icu": { kind: "match", hostname: "stale.icu" },
      },
      [
        { Domain: "new.icu", Expiry: "2027-01-01T00:00:00Z" },
        { Domain: "stale.icu", Expiry: "2027-01-01T00:00:00Z" },
        { Domain: "fake.icu", Expiry: "2027-01-01T00:00:00Z" },
        { Domain: "known.icu", Expiry: "2027-01-01T00:00:00Z" },
        { Domain: "mymap.icu", Expiry: "2027-01-01T00:00:00Z" },
      ],
    );

    await service.refreshFromEndpoint();

    expect(repository.addDomain).toHaveBeenCalledTimes(2);
    expect(repository.addDomain).toHaveBeenCalledWith({
      hostname: "new.icu",
      provider: "grabify",
      source: "endpoint",
    });
    expect(repository.addDomain).toHaveBeenCalledWith({
      hostname: "stale.icu",
      provider: "grabify",
      source: "endpoint",
    });
    // Active and seeded domains aren't looked up again.
    expect(detector.check).toHaveBeenCalledTimes(3);
  });

  test("recheck records passes and misses but skips lookup errors", async () => {
    const { service, repository } = setup({
      "a.icu": { kind: "match", hostname: "a.icu" },
      "c.icu": { kind: "error", err: new Error("timeout") },
    });

    await service.recheckDomains();

    expect(repository.recordCheck).toHaveBeenCalledTimes(2);
    expect(repository.recordCheck).toHaveBeenCalledWith("a.icu", true, 3);
    expect(repository.recordCheck).toHaveBeenCalledWith("b.icu", false, 3);
  });
});
