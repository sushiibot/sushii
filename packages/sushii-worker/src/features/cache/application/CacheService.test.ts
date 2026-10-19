import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

import type {
  CachedGuildEntity,
  CachedGuildRepository,
  CachedUserEntity,
  CachedUserRepository,
} from "../domain";
import { CacheService } from "./CacheService";

// Mock repositories
const mockGuildRepository: CachedGuildRepository = {
  upsert: mock(() => Promise.resolve({} as CachedGuildEntity)),
  // These methods are not used by CacheService - called directly by event handlers
  incrementMemberCount: () => Promise.resolve(true),
  decrementMemberCount: () => Promise.resolve(true),
};

const mockUserRepository: CachedUserRepository = {
  upsert: mock(() => Promise.resolve({} as CachedUserEntity)),
  batchUpsert: mock(() => Promise.resolve([{} as CachedUserEntity])),
};

const testConfig = {
  userBatchSize: 3,
  userFlushIntervalMs: 100,
};

describe("CacheService", () => {
  let cacheService: CacheService;

  beforeEach(() => {
    // Reset mocks
    mock.restore();
    mockGuildRepository.upsert = mock(() =>
      Promise.resolve({} as CachedGuildEntity),
    );
    mockUserRepository.upsert = mock(() =>
      Promise.resolve({} as CachedUserEntity),
    );
    mockUserRepository.batchUpsert = mock(() =>
      Promise.resolve([{} as CachedUserEntity]),
    );

    cacheService = new CacheService(
      mockGuildRepository,
      mockUserRepository,
      testConfig,
    );
  });

  afterEach(async () => {
    await cacheService.shutdown();
  });

  test("cacheGuild calls repository upsert immediately", async () => {
    const guildData = {
      id: BigInt(123),
      name: "Test Guild",
      icon: null,
      banner: null,
      splash: null,
      features: ["COMMUNITY"],
    };

    await cacheService.cacheGuild(guildData);

    expect(mockGuildRepository.upsert).toHaveBeenCalledWith(guildData);
    expect(mockGuildRepository.upsert).toHaveBeenCalledTimes(1);
  });

  test("cacheUser queues users and batches them", async () => {
    const userData1 = {
      id: BigInt(1),
      name: "User1",
      discriminator: 1234,
      avatarUrl: "https://example.com/1.png",
      lastChecked: new Date(),
    };
    const userData2 = {
      id: BigInt(2),
      name: "User2",
      discriminator: 5678,
      avatarUrl: "https://example.com/2.png",
      lastChecked: new Date(),
    };

    // Add users to queue (should not trigger flush yet)
    await cacheService.cacheUser(userData1);
    await cacheService.cacheUser(userData2);

    expect(mockUserRepository.batchUpsert).not.toHaveBeenCalled();
  });

  test("cacheUser flushes when batch size is reached", async () => {
    const users = Array.from({ length: 3 }, (_, i) => ({
      id: BigInt(i + 1),
      name: `User${i + 1}`,
      discriminator: 1000 + i,
      avatarUrl: `https://example.com/${i + 1}.png`,
      lastChecked: new Date(),
    }));

    // Add users to reach batch size
    for (const user of users) {
      await cacheService.cacheUser(user);
    }

    // Should have triggered batch flush
    expect(mockUserRepository.batchUpsert).toHaveBeenCalledWith(users);
    expect(mockUserRepository.batchUpsert).toHaveBeenCalledTimes(1);
  });

  test("cacheGuild propagates repository errors", async () => {
    const dbError = new Error("connection lost");
    mockGuildRepository.upsert = mock(() => Promise.reject(dbError));

    await expect(
      cacheService.cacheGuild({
        id: BigInt(123),
        name: "Test Guild",
        icon: null,
        banner: null,
        splash: null,
        features: [],
      }),
    ).rejects.toThrow("connection lost");
  });

  test("failed user flush re-queues the batch for retry", async () => {
    const users = Array.from({ length: 3 }, (_, i) => ({
      id: BigInt(i + 1),
      name: `User${i + 1}`,
      discriminator: 1000 + i,
      avatarUrl: `https://example.com/${i + 1}.png`,
      lastChecked: new Date(),
    }));

    mockUserRepository.batchUpsert = mock(() =>
      Promise.reject(new Error("connection lost")),
    );

    // Reaching batch size triggers a flush that fails but must not throw
    for (const user of users) {
      await cacheService.cacheUser(user);
    }

    expect(mockUserRepository.batchUpsert).toHaveBeenCalledTimes(1);

    mockUserRepository.batchUpsert = mock(() =>
      Promise.resolve([{} as CachedUserEntity]),
    );
    await cacheService.shutdown();

    expect(mockUserRepository.batchUpsert).toHaveBeenCalledWith(users);
  });

  test("shutdown flushes remaining users in queue", async () => {
    const userData = {
      id: BigInt(1),
      name: "User1",
      discriminator: 1234,
      avatarUrl: "https://example.com/1.png",
      lastChecked: new Date(),
    };

    await cacheService.cacheUser(userData);

    // Shutdown should flush remaining users
    await cacheService.shutdown();

    expect(mockUserRepository.batchUpsert).toHaveBeenCalledWith([userData]);
  });
});
