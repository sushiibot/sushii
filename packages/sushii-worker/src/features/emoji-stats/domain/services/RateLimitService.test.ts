import { describe, expect, mock, test } from "bun:test";

import { RateLimit } from "../entities";
import type { RateLimitRepository } from "../repositories";
import { RateLimitService } from "./RateLimitService";

function createRepository(rateLimitedAssetIds: string[] = []) {
  return {
    findActiveRateLimits: mock(async () =>
      rateLimitedAssetIds.map(
        (assetId) => new RateLimit("user", assetId, "message", new Date()),
      ),
    ),
    upsertRateLimits: mock(() => Promise.resolve()),
  } as unknown as RateLimitRepository;
}

describe("RateLimitService.filterRateLimitedUsage", () => {
  test("returns each eligible asset once even if repeated in attempts", async () => {
    const service = new RateLimitService(createRepository());

    const result = await service.filterRateLimitedUsage("user", "message", [
      { assetId: "1" },
      { assetId: "1" },
      { assetId: "2" },
      { assetId: "1" },
    ]);

    expect(result).toEqual([{ assetId: "1" }, { assetId: "2" }]);
  });

  test("excludes rate limited assets", async () => {
    const service = new RateLimitService(createRepository(["1"]));

    const result = await service.filterRateLimitedUsage("user", "message", [
      { assetId: "1" },
      { assetId: "2" },
      { assetId: "2" },
    ]);

    expect(result).toEqual([{ assetId: "2" }]);
  });
});
