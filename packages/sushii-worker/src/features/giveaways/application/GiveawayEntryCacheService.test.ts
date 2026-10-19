import { sleep } from "bun";
import { describe, expect, mock, test } from "bun:test";
import type { Message } from "discord.js";
import pino from "pino";
import { Err, Ok } from "ts-results";
import type { Result } from "ts-results";

import { Giveaway } from "../domain/entities/Giveaway";
import type { GiveawayEntry } from "../domain/entities/GiveawayEntry";
import type { GiveawayEntryRepository } from "../domain/repositories/GiveawayEntryRepository";
import type { GiveawayRepository } from "../domain/repositories/GiveawayRepository";
import type { GiveawayEntryCacheOptions } from "./GiveawayEntryCacheService";
import { GiveawayEntryCacheService } from "./GiveawayEntryCacheService";

const GUILD_ID = "100";
const GIVEAWAY_ID = "200";

function makeMessage(id = GIVEAWAY_ID): Message<true> {
  return { id, guildId: GUILD_ID } as Message<true>;
}

function makeGiveaway(overrides: { isEnded?: boolean; endAt?: Date } = {}) {
  return new Giveaway({
    id: GIVEAWAY_ID,
    channelId: "300",
    guildId: GUILD_ID,
    hostUserId: "400",
    numWinners: 1,
    prize: "prize",
    startAt: new Date(Date.now() - 60_000),
    endAt: overrides.endAt ?? new Date(Date.now() + 60_000),
    isEnded: overrides.isEnded ?? false,
  });
}

function setup(
  options: {
    createBatch?: (entries: GiveawayEntry[]) => Promise<Result<number, string>>;
    giveaway?: Giveaway | null;
    cacheOptions?: Partial<GiveawayEntryCacheOptions>;
  } = {},
) {
  const stored: GiveawayEntry[] = [];

  const createBatch = mock(
    options.createBatch ??
      (async (entries: GiveawayEntry[]) => {
        stored.push(...entries);
        return Ok(entries.length);
      }),
  );
  const countByGiveaway = mock(async (giveawayId: string) =>
    Ok(stored.filter((e) => e.giveawayId === giveawayId).length),
  );
  const entryRepo = {
    createBatch,
    countByGiveaway,
  } as unknown as GiveawayEntryRepository;

  const giveaway =
    options.giveaway === undefined ? makeGiveaway() : options.giveaway;
  const giveawayRepo = {
    findByGuildAndId: mock(async () => Ok(giveaway)),
  } as unknown as GiveawayRepository;

  const updateEntryCount = mock(
    async (_message: Message<true>, _count: number): Promise<void> => {
      return;
    },
  );

  const service = new GiveawayEntryCacheService(
    entryRepo,
    giveawayRepo,
    updateEntryCount,
    pino({ level: "silent" }),
    { debounceMs: 30, maxWaitMs: 80, ...options.cacheOptions },
  );

  return { service, stored, createBatch, updateEntryCount };
}

describe("GiveawayEntryCacheService", () => {
  test("successful flush inserts entries and clears the cache", async () => {
    const { service, stored, createBatch } = setup();
    const msg = makeMessage();

    await service.addEntryToCache(GIVEAWAY_ID, "u1", msg);
    await service.addEntryToCache(GIVEAWAY_ID, "u2", msg);
    expect(service.isInCache(GIVEAWAY_ID, "u1")).toBe(true);

    await service.flush();

    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(stored.map((e) => e.userId).sort()).toEqual(["u1", "u2"]);
    expect(service.isInCache(GIVEAWAY_ID, "u1")).toBe(false);
    expect(service.isInCache(GIVEAWAY_ID, "u2")).toBe(false);
  });

  test("failed insert (Err) retains entries for retry", async () => {
    const { service, createBatch, updateEntryCount } = setup({
      createBatch: async () => Err("db down"),
    });

    await service.addEntryToCache(GIVEAWAY_ID, "u1", makeMessage());
    await service.flush();

    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(service.isInCache(GIVEAWAY_ID, "u1")).toBe(true);
    expect(updateEntryCount).not.toHaveBeenCalled();

    // Retried on the next flush with the same entries
    await service.flush();
    expect(createBatch).toHaveBeenCalledTimes(2);
    expect(createBatch.mock.calls[1][0].map((e) => e.userId)).toEqual(["u1"]);
  });

  test("failed insert (throw) retains entries", async () => {
    const { service } = setup({
      createBatch: async () => {
        throw new Error("connection lost");
      },
    });

    await service.addEntryToCache(GIVEAWAY_ID, "u1", makeMessage());
    await service.flush();

    expect(service.isInCache(GIVEAWAY_ID, "u1")).toBe(true);
  });

  test("entries added during an in-progress flush survive", async () => {
    const stored: GiveawayEntry[] = [];
    let releaseInsert!: () => void;
    let callCount = 0;
    const { service, createBatch } = setup({
      createBatch: async (entries) => {
        callCount += 1;
        if (callCount === 1) {
          await new Promise<void>((resolve) => {
            releaseInsert = resolve;
          });
        }
        stored.push(...entries);
        return Ok(entries.length);
      },
    });
    const msg = makeMessage();

    await service.addEntryToCache(GIVEAWAY_ID, "u1", msg);
    const flushPromise = service.flush();

    // Mid-flush: in-flight user is still reported as entered
    expect(service.isInCache(GIVEAWAY_ID, "u1")).toBe(true);

    await service.addEntryToCache(GIVEAWAY_ID, "u2", msg);

    releaseInsert();
    await flushPromise;

    expect(service.isInCache(GIVEAWAY_ID, "u1")).toBe(false);
    expect(service.isInCache(GIVEAWAY_ID, "u2")).toBe(true);

    await service.flush();
    expect(createBatch).toHaveBeenCalledTimes(2);
    expect(stored.map((e) => e.userId).sort()).toEqual(["u1", "u2"]);
  });

  test("entries added during a failing flush are merged with restored ones", async () => {
    let rejectInsert!: () => void;
    let callCount = 0;
    const { service, createBatch } = setup({
      createBatch: async (entries) => {
        callCount += 1;
        if (callCount === 1) {
          await new Promise<void>((resolve) => {
            rejectInsert = resolve;
          });
          return Err("db down");
        }
        return Ok(entries.length);
      },
    });
    const msg = makeMessage();

    await service.addEntryToCache(GIVEAWAY_ID, "u1", msg);
    const flushPromise = service.flush();
    await service.addEntryToCache(GIVEAWAY_ID, "u2", msg);
    rejectInsert();
    await flushPromise;

    expect(service.isInCache(GIVEAWAY_ID, "u1")).toBe(true);
    expect(service.isInCache(GIVEAWAY_ID, "u2")).toBe(true);

    await service.flush();
    expect(
      createBatch.mock.calls[1][0].map((e: GiveawayEntry) => e.userId).sort(),
    ).toEqual(["u1", "u2"]);
  });

  test("flushes under continuous entries via max wait", async () => {
    const { service, createBatch } = setup({
      cacheOptions: { debounceMs: 30, maxWaitMs: 80 },
    });
    const msg = makeMessage();

    // Add an entry every 10ms (< debounce) for ~200ms
    for (let i = 0; i < 20; i++) {
      await service.addEntryToCache(GIVEAWAY_ID, `u${i}`, msg);
      await sleep(10);
    }

    expect(createBatch.mock.calls.length).toBeGreaterThanOrEqual(2);
    await service.flush();
  });

  test("debounce flushes after inactivity", async () => {
    const { service, createBatch } = setup({
      cacheOptions: { debounceMs: 20, maxWaitMs: 1000 },
    });

    await service.addEntryToCache(GIVEAWAY_ID, "u1", makeMessage());
    expect(createBatch).not.toHaveBeenCalled();

    await sleep(60);
    expect(createBatch).toHaveBeenCalledTimes(1);
  });

  test("concurrent flushes do not overlap", async () => {
    let active = 0;
    let maxActive = 0;
    const { service, createBatch } = setup({
      createBatch: async (entries) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(20);
        active -= 1;
        return Ok(entries.length);
      },
    });
    const msg = makeMessage();

    await service.addEntryToCache(GIVEAWAY_ID, "u1", msg);
    const first = service.flush();
    await service.addEntryToCache(GIVEAWAY_ID, "u2", msg);
    const second = service.flush();
    await Promise.all([first, second]);

    expect(maxActive).toBe(1);
    expect(createBatch).toHaveBeenCalledTimes(2);
    expect(service.isInCache(GIVEAWAY_ID, "u2")).toBe(false);
  });

  test("updates the giveaway message with the entry count once per flush", async () => {
    const { service, updateEntryCount } = setup();
    const msg = makeMessage();

    await service.addEntryToCache(GIVEAWAY_ID, "u1", msg);
    await service.addEntryToCache(GIVEAWAY_ID, "u2", msg);
    await service.addEntryToCache(GIVEAWAY_ID, "u3", msg);
    await service.flush();

    expect(updateEntryCount).toHaveBeenCalledTimes(1);
    expect(updateEntryCount).toHaveBeenCalledWith(msg, 3);
  });

  test("does not update message for ended giveaways", async () => {
    const { service, updateEntryCount, createBatch } = setup({
      giveaway: makeGiveaway({ isEnded: true }),
    });

    await service.addEntryToCache(GIVEAWAY_ID, "u1", makeMessage());
    await service.flush();

    expect(createBatch).toHaveBeenCalledTimes(1);
    expect(updateEntryCount).not.toHaveBeenCalled();
  });

  test("does not update message for expired giveaways", async () => {
    const { service, updateEntryCount } = setup({
      giveaway: makeGiveaway({ endAt: new Date(Date.now() - 1000) }),
    });

    await service.addEntryToCache(GIVEAWAY_ID, "u1", makeMessage());
    await service.flush();

    expect(updateEntryCount).not.toHaveBeenCalled();
  });

  test("message update failure does not throw", async () => {
    const { service, updateEntryCount } = setup();
    updateEntryCount.mockImplementation(async () => {
      throw new Error("Missing Access");
    });

    await service.addEntryToCache(GIVEAWAY_ID, "u1", makeMessage());
    await service.flush();

    expect(updateEntryCount).toHaveBeenCalledTimes(1);
  });
});
