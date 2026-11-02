import type { Logger } from "pino";

import type { IpGrabberRepository } from "../domain/IpGrabberRepository";
import { normalizeHostname } from "../domain/hostnames";
import { IP_GRABBER_PROVIDERS } from "../domain/providers";
import type { IpGrabberMetrics } from "../infrastructure/IpGrabberMetrics";
import type { IpGrabberDetector } from "./IpGrabberDetector";

// Only this exact URL answers; Grabify's server 404s every other form of it.
const GRABIFY_DOMAINS_URL = "https://grabify.link/api/domains?r=124";
const ENDPOINT_TIMEOUT_MS = 10_000;
/** Consecutive failed daily checks before a domain stops being blocked. */
export const STALE_AFTER_FAILED_CHECKS = 3;

interface EndpointEntry {
  Domain: unknown;
  Expiry: unknown;
}

/** Unexpired hostnames from the endpoint payload; null when it isn't the expected shape. */
export function parseGrabifyDomains(
  payload: unknown,
  now: Date,
): string[] | null {
  if (!Array.isArray(payload)) {
    return null;
  }

  const hostnames: string[] = [];
  for (const entry of payload as EndpointEntry[]) {
    if (typeof entry?.Domain !== "string") {
      continue;
    }
    if (entry.Expiry !== null) {
      const expiry =
        typeof entry.Expiry === "string" ? new Date(entry.Expiry) : null;
      if (!expiry || Number.isNaN(expiry.getTime()) || expiry <= now) {
        continue;
      }
    }

    const hostname = normalizeHostname(entry.Domain);
    if (hostname) {
      hostnames.push(hostname);
    }
  }

  return hostnames;
}

export class IpGrabberMaintenanceService {
  constructor(
    private readonly repository: IpGrabberRepository,
    private readonly detector: IpGrabberDetector,
    private readonly metrics: IpGrabberMetrics,
    private readonly logger: Logger,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  /** Adds Grabify's own published domains, each confirmed by the DNS check. */
  async refreshFromEndpoint(): Promise<void> {
    let payload: unknown;
    try {
      const response = await this.fetchFn(GRABIFY_DOMAINS_URL, {
        signal: AbortSignal.timeout(ENDPOINT_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.metrics.endpointFetchCounter.add(1, { outcome: "http_error" });
        this.logger.info(
          { status: response.status },
          "Grabify domain list unavailable",
        );
        return;
      }
      payload = await response.json();
    } catch (err) {
      this.metrics.endpointFetchCounter.add(1, { outcome: "error" });
      this.logger.info({ err }, "Grabify domain list fetch failed");
      return;
    }

    const hostnames = parseGrabifyDomains(payload, new Date());
    if (!hostnames) {
      this.metrics.endpointFetchCounter.add(1, { outcome: "bad_payload" });
      this.logger.warn("Grabify domain list had an unexpected shape");
      return;
    }
    this.metrics.endpointFetchCounter.add(1, { outcome: "ok" });

    const seeds = new Set(IP_GRABBER_PROVIDERS.grabify.seedDomains);
    for (const hostname of hostnames) {
      if (seeds.has(hostname) || (await this.repository.findDomain(hostname))) {
        continue;
      }

      const result = await this.detector.check("grabify", hostname);
      this.metrics.checkCounter.add(1, {
        provider: "grabify",
        outcome: result.kind,
      });
      if (result.kind !== "match" || result.hostname !== hostname) {
        continue;
      }

      if (
        await this.repository.addDomain({
          hostname,
          provider: "grabify",
          source: "endpoint",
        })
      ) {
        this.metrics.discoveredCounter.add(1, {
          provider: "grabify",
          source: "endpoint",
        });
        this.logger.info({ hostname }, "Added Grabify domain from its list");
      }
    }
  }

  /** Domains that stop matching for a few days in a row are no longer blocked. */
  async recheckDomains(): Promise<void> {
    for (const domain of await this.repository.listDomainsToRecheck()) {
      const result = await this.detector.check(
        domain.provider,
        domain.hostname,
      );
      this.metrics.checkCounter.add(1, {
        provider: domain.provider,
        outcome: result.kind,
      });
      if (result.kind === "error") {
        continue;
      }

      await this.repository.recordCheck(
        domain.hostname,
        result.kind === "match",
        STALE_AFTER_FAILED_CHECKS,
      );
    }
  }
}
