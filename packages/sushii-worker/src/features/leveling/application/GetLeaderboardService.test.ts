import { describe, expect, mock, test } from "bun:test";

import type { UserLevelRepository } from "../domain/repositories/UserLevelRepository";
import { TimeFrame } from "../domain/value-objects/TimeFrame";
import { GetLeaderboardService } from "./GetLeaderboardService";

function createRepository(
  overrides: Partial<Record<keyof UserLevelRepository, unknown>> = {},
): UserLevelRepository {
  return {
    getLeaderboardPage: mock(async () => []),
    getUserCountInTimeframe: mock(async () => 0),
    getUserGuildRankings: mock(async () => undefined),
    getUserGuildLevel: mock(async () => ({ getAllTimeXp: () => 0 })),
    ...overrides,
  } as unknown as UserLevelRepository;
}

describe("GetLeaderboardService", () => {
  test("propagates errors fetching the user's rank", async () => {
    const dbError = new Error("connection lost");
    const service = new GetLeaderboardService(
      createRepository({
        getUserGuildRankings: mock(async () => {
          throw dbError;
        }),
      }),
    );

    await expect(
      service.getLeaderboard("guild", "user", TimeFrame.ALL_TIME, 0, 10),
    ).rejects.toThrow();
  });

  test("propagates errors fetching the user's level", async () => {
    const dbError = new Error("connection lost");
    const service = new GetLeaderboardService(
      createRepository({
        getUserGuildLevel: mock(async () => {
          throw dbError;
        }),
      }),
    );

    await expect(
      service.getLeaderboard("guild", "user", TimeFrame.ALL_TIME, 0, 10),
    ).rejects.toThrow();
  });

  test("omits user level when the user has no XP", async () => {
    const service = new GetLeaderboardService(createRepository());

    const result = await service.getLeaderboard(
      "guild",
      "user",
      TimeFrame.ALL_TIME,
      0,
      10,
    );

    expect(result.userLevel).toBeUndefined();
  });
});
