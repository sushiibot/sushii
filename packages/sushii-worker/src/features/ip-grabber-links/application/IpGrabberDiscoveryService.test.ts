import { describe, expect, mock, test } from "bun:test";
import {
  type Client,
  GuildFeature,
  PermissionFlagsBits,
  PermissionsBitField,
} from "discord.js";
import type { Logger } from "pino";

import type { IpGrabberRepository } from "../domain/IpGrabberRepository";
import type { IpGrabberMetrics } from "../infrastructure/IpGrabberMetrics";
import type { CheckResult, IpGrabberDetector } from "./IpGrabberDetector";
import { IpGrabberDiscoveryService } from "./IpGrabberDiscoveryService";

const GUILD_ID = "100000000000000001";
const CHANNEL_ID = "200000000000000001";

function makeClient(opts: { discoverable?: boolean; public?: boolean } = {}) {
  const everyone = {};
  const channel = {
    name: "general",
    permissionsFor: () =>
      new PermissionsBitField(
        opts.public === false ? 0n : PermissionFlagsBits.ViewChannel,
      ),
  };
  const guild = {
    name: "KPOP Hub",
    features: opts.discoverable === false ? [] : [GuildFeature.Discoverable],
    roles: { everyone },
    channels: { cache: new Map([[CHANNEL_ID, channel]]) },
  };
  return {
    guilds: { cache: new Map([[GUILD_ID, guild]]) },
  } as unknown as Client;
}

function setup(
  results: Record<string, Partial<Record<string, CheckResult>>>,
  clientOpts?: Parameters<typeof makeClient>[0],
) {
  const repository = {
    listActiveHostnames: mock(
      async () => new Map([["grabify", ["known.click"]]]),
    ),
    listRevertedHostnames: mock(async () => new Set(["reverted.click"])),
    addDomain: mock(async () => true),
  } as unknown as IpGrabberRepository;
  const detector = {
    check: mock(
      async (provider: string, hostname: string): Promise<CheckResult> =>
        results[hostname]?.[provider] ?? { kind: "no_match" },
    ),
  } as unknown as IpGrabberDetector;
  const counter = { add: mock(() => undefined) };
  const metrics = {
    checkCounter: counter,
    discoveredCounter: counter,
  } as unknown as IpGrabberMetrics;
  const logger = { info: mock(() => undefined) } as unknown as Logger;

  const service = new IpGrabberDiscoveryService(
    makeClient(clientOpts),
    repository,
    detector,
    metrics,
    logger,
  );
  return { service, repository, detector };
}

const sighting = (content: string) => ({
  guildId: GUILD_ID,
  channelId: CHANNEL_ID,
  content,
});

describe("IpGrabberDiscoveryService", () => {
  test("adds a matching domain with where it was first seen", async () => {
    const { service, repository } = setup({
      "links.pics-share.click": {
        grabify: { kind: "match", hostname: "pics-share.click" },
      },
    });

    await service.observe(
      sighting("free nitro https://links.pics-share.click/abc"),
    );

    expect(repository.addDomain).toHaveBeenCalledWith({
      hostname: "pics-share.click",
      provider: "grabify",
      source: "discovered",
      firstSeenGuildId: GUILD_ID,
      firstSeenGuildName: "KPOP Hub",
      firstSeenChannelId: CHANNEL_ID,
      firstSeenChannelName: "general",
    });
  });

  test("skips seeded, known, reverted and popular domains", async () => {
    const { service, detector } = setup({});

    await service.observe(
      sighting(
        "https://mymap.icu/a https://www.known.click https://reverted.click https://youtube.com/watch",
      ),
    );

    expect(detector.check).not.toHaveBeenCalled();
  });

  test("caches a clean hostname but retries after a lookup error", async () => {
    const { service, detector } = setup({
      "flaky.com": { grabify: { kind: "error", err: new Error("timeout") } },
    });

    await service.observe(sighting("https://clean.com https://flaky.com"));
    await service.observe(sighting("https://clean.com https://flaky.com"));

    const checked = (detector.check as ReturnType<typeof mock>).mock.calls.map(
      ([provider, hostname]) => `${provider}:${hostname}`,
    );
    expect(checked.filter((c) => c.endsWith(":clean.com"))).toHaveLength(2);
    expect(checked.filter((c) => c.endsWith(":flaky.com"))).toHaveLength(4);
  });

  test("ignores private channels and non-discoverable servers", async () => {
    for (const opts of [{ public: false }, { discoverable: false }]) {
      const { service, detector } = setup({}, opts);
      await service.observe(sighting("https://example.com"));
      expect(detector.check).not.toHaveBeenCalled();
    }
  });
});
