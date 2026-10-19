import { describe, expect, mock, test } from "bun:test";
import type { Guild } from "discord.js";
import pino from "pino";

import type { BanRepository } from "../domain/repositories/BanRepository";
import { BanCacheService } from "./BanCacheService";

const logger = pino({ level: "silent" });

function createRepository(overrides: Partial<BanRepository> = {}) {
  return {
    addBan: mock(() => Promise.resolve()),
    removeBan: mock(() => Promise.resolve()),
    clearGuildBans: mock(() => Promise.resolve()),
    addGuildBans: mock(() => Promise.resolve()),
    getUserBans: mock(() => Promise.resolve([])),
    ...overrides,
  } satisfies BanRepository;
}

function createGuild(pages: string[][]): Guild {
  let call = 0;
  return {
    id: "guild-1",
    name: "Guild",
    bans: {
      fetch: mock(() => {
        const ids = pages[call++] ?? [];
        const map = new Map(ids.map((id) => [id, {}]));
        return Promise.resolve(
          Object.assign(map, { lastKey: () => ids[ids.length - 1] }),
        );
      }),
    },
  } as unknown as Guild;
}

describe("BanCacheService", () => {
  test("handleBanAdd propagates repository errors", async () => {
    const repo = createRepository({
      addBan: mock(() => Promise.reject(new Error("db down"))),
    });
    const service = new BanCacheService(repo, logger);

    await expect(service.handleBanAdd("guild-1", "user-1")).rejects.toThrow(
      "db down",
    );
  });

  test("handleGuildJoin propagates clear failures", async () => {
    const repo = createRepository({
      clearGuildBans: mock(() => Promise.reject(new Error("db down"))),
    });
    const service = new BanCacheService(repo, logger);

    await expect(service.handleGuildJoin(createGuild([]))).rejects.toThrow(
      "db down",
    );
    expect(repo.addGuildBans).not.toHaveBeenCalled();
  });

  test("handleGuildJoin syncs a single page of bans", async () => {
    const repo = createRepository();
    const service = new BanCacheService(repo, logger);

    await service.handleGuildJoin(createGuild([["user-1", "user-2"]]));

    expect(repo.clearGuildBans).toHaveBeenCalledWith("guild-1");
    expect(repo.addGuildBans).toHaveBeenCalledWith("guild-1", [
      "user-1",
      "user-2",
    ]);
  });

  test("handleGuildJoin does not throw when a page insert fails", async () => {
    const repo = createRepository({
      addGuildBans: mock(() => Promise.reject(new Error("db down"))),
    });
    const service = new BanCacheService(repo, logger);

    await service.handleGuildJoin(createGuild([["user-1"]]));

    expect(repo.addGuildBans).toHaveBeenCalledTimes(1);
  });
});
