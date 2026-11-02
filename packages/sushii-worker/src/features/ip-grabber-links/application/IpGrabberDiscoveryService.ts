import type { Client } from "discord.js";
import type { Logger } from "pino";

import { publicChannelSkipReason } from "@/features/automod/utils/publicChannel";

import type { IpGrabberRepository } from "../domain/IpGrabberRepository";
import { extractHostnames, hostnameCandidates } from "../domain/hostnames";
import { toKeyword } from "../domain/keywords";
import {
  IP_GRABBER_PROVIDERS,
  IP_GRABBER_PROVIDER_IDS,
} from "../domain/providers";
import type { IpGrabberMetrics } from "../infrastructure/IpGrabberMetrics";
import type { IpGrabberDetector } from "./IpGrabberDetector";

const NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000;
const KNOWN_REFRESH_MS = 60 * 1000;
const MAX_CACHED_VERDICTS = 100_000;
const MAX_IN_FLIGHT = 20;

export interface LinkSighting {
  guildId: string;
  channelId: string;
  content: string;
}

/**
 * Checks links posted in public channels of Discoverable servers and adds
 * new IP grabber domains to the shared list. Blocking is left to the
 * servers' native AutoMod rules.
 */
export class IpGrabberDiscoveryService {
  private readonly cleared = new Map<string, number>();
  private readonly inFlight = new Set<string>();
  private known = new Set<string>();
  private knownLoadedAt = 0;

  constructor(
    private readonly client: Client,
    private readonly repository: IpGrabberRepository,
    private readonly detector: IpGrabberDetector,
    private readonly metrics: IpGrabberMetrics,
    private readonly logger: Logger,
  ) {}

  async observe(sighting: LinkSighting): Promise<void> {
    const hostnames = extractHostnames(sighting.content).filter(
      (hostname) => toKeyword(hostname) !== null,
    );
    if (hostnames.length === 0) {
      return;
    }
    if (
      publicChannelSkipReason(this.client, sighting.guildId, sighting.channelId)
    ) {
      return;
    }

    await this.refreshKnown();
    const now = Date.now();
    const pending = hostnames.filter(
      (hostname) =>
        !this.isKnown(hostname) &&
        (this.cleared.get(hostname) ?? 0) < now &&
        !this.inFlight.has(hostname),
    );

    for (const hostname of pending) {
      if (this.inFlight.size >= MAX_IN_FLIGHT) {
        return;
      }

      this.inFlight.add(hostname);
      try {
        await this.checkHostname(hostname, sighting);
      } finally {
        this.inFlight.delete(hostname);
      }
    }
  }

  private isKnown(hostname: string): boolean {
    return hostnameCandidates(hostname).some((c) => this.known.has(c));
  }

  private async refreshKnown(): Promise<void> {
    if (Date.now() - this.knownLoadedAt < KNOWN_REFRESH_MS) {
      return;
    }

    const [active, reverted] = await Promise.all([
      this.repository.listActiveHostnames(),
      this.repository.listRevertedHostnames(),
    ]);
    this.known = new Set([
      ...IP_GRABBER_PROVIDER_IDS.flatMap((id) => [
        ...IP_GRABBER_PROVIDERS[id].seedDomains,
        ...(active.get(id) ?? []),
      ]),
      ...reverted,
    ]);
    this.knownLoadedAt = Date.now();
  }

  private async checkHostname(
    hostname: string,
    sighting: LinkSighting,
  ): Promise<void> {
    let lookupFailed = false;

    for (const provider of IP_GRABBER_PROVIDER_IDS) {
      const result = await this.detector.check(provider, hostname);
      this.metrics.checkCounter.add(1, { provider, outcome: result.kind });

      if (result.kind === "error") {
        lookupFailed = true;
        continue;
      }
      if (result.kind === "no_match") {
        continue;
      }

      await this.addDiscovered(result.hostname, provider, sighting);
      return;
    }

    // A failed lookup is retried on the next sighting rather than cached as clean.
    if (!lookupFailed) {
      this.markCleared(hostname);
    }
  }

  private async addDiscovered(
    hostname: string,
    provider: (typeof IP_GRABBER_PROVIDER_IDS)[number],
    sighting: LinkSighting,
  ): Promise<void> {
    const guild = this.client.guilds.cache.get(sighting.guildId);
    const channel = guild?.channels.cache.get(sighting.channelId);

    const added = await this.repository.addDomain({
      hostname,
      provider,
      source: "discovered",
      firstSeenGuildId: sighting.guildId,
      firstSeenGuildName: guild?.name,
      firstSeenChannelId: sighting.channelId,
      firstSeenChannelName: channel?.name,
    });
    this.known.add(hostname);

    if (added) {
      this.metrics.discoveredCounter.add(1, { provider, source: "discovered" });
      this.logger.info(
        { hostname, provider, guildId: sighting.guildId },
        "Discovered new IP grabber domain",
      );
    }
  }

  private markCleared(hostname: string): void {
    if (this.cleared.size >= MAX_CACHED_VERDICTS) {
      const oldest = this.cleared.keys().next().value;
      if (oldest !== undefined) {
        this.cleared.delete(oldest);
      }
    }
    this.cleared.set(hostname, Date.now() + NEGATIVE_TTL_MS);
  }
}
