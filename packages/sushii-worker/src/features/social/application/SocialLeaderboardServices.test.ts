import { describe, expect, mock, test } from "bun:test";

import type { UserProfileRepository } from "@/features/user-profile";

import type { SocialLeaderboardRepository } from "../domain/repositories/SocialLeaderboardRepository";
import { FishyLeaderboardService } from "./FishyLeaderboardService";
import { RepLeaderboardService } from "./RepLeaderboardService";

const dbError = new Error("connection lost");

function failing() {
  return mock(async () => {
    throw dbError;
  });
}

function createLeaderboardRepository(
  overrides: Partial<Record<keyof SocialLeaderboardRepository, unknown>> = {},
): SocialLeaderboardRepository {
  return {
    getRepLeaderboardPage: mock(async () => []),
    getRepLeaderboardCount: mock(async () => 0),
    getUserRepRank: mock(async () => null),
    getFishyLeaderboardPage: mock(async () => []),
    getFishyLeaderboardCount: mock(async () => 0),
    getUserFishyRank: mock(async () => null),
    ...overrides,
  } as unknown as SocialLeaderboardRepository;
}

function createProfileRepository(
  getByIdOrDefault: unknown = mock(async () => ({
    getRep: () => 0n,
    getFishies: () => 0n,
  })),
): UserProfileRepository {
  return { getByIdOrDefault } as unknown as UserProfileRepository;
}

describe("RepLeaderboardService", () => {
  test("propagates errors fetching the user's rank", async () => {
    const service = new RepLeaderboardService(
      createLeaderboardRepository({ getUserRepRank: failing() }),
      createProfileRepository(),
    );

    await expect(
      service.getRepLeaderboard("guild", "user", 0, 10),
    ).rejects.toThrow();
  });

  test("propagates errors fetching the user's profile", async () => {
    const service = new RepLeaderboardService(
      createLeaderboardRepository(),
      createProfileRepository(failing()),
    );

    await expect(
      service.getRepLeaderboard("guild", "user", 0, 10),
    ).rejects.toThrow();
  });

  test("omits rank and amount when the user has none", async () => {
    const service = new RepLeaderboardService(
      createLeaderboardRepository(),
      createProfileRepository(),
    );

    const result = await service.getRepLeaderboard("guild", "user", 0, 10);

    expect(result.userRank).toBeUndefined();
    expect(result.userAmount).toBeUndefined();
  });
});

describe("FishyLeaderboardService", () => {
  test("propagates errors fetching the user's rank", async () => {
    const service = new FishyLeaderboardService(
      createLeaderboardRepository({ getUserFishyRank: failing() }),
      createProfileRepository(),
    );

    await expect(
      service.getFishyLeaderboard("guild", "user", 0, 10),
    ).rejects.toThrow();
  });

  test("propagates errors fetching the user's profile", async () => {
    const service = new FishyLeaderboardService(
      createLeaderboardRepository(),
      createProfileRepository(failing()),
    );

    await expect(
      service.getFishyLeaderboard("guild", "user", 0, 10),
    ).rejects.toThrow();
  });

  test("omits rank and amount when the user has none", async () => {
    const service = new FishyLeaderboardService(
      createLeaderboardRepository(),
      createProfileRepository(),
    );

    const result = await service.getFishyLeaderboard("guild", "user", 0, 10);

    expect(result.userRank).toBeUndefined();
    expect(result.userAmount).toBeUndefined();
  });
});
