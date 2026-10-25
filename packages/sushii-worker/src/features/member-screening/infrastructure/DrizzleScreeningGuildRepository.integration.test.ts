import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";

import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { ScreeningGuildSettings } from "../domain/types";
import { SCREENING_DEFAULTS } from "../domain/types";
import { DrizzleScreeningGuildRepository } from "./DrizzleScreeningGuildRepository";

const GUILD = "100000000000000001";
const logger = pino({ level: "silent" });

function settings(
  overrides: Partial<ScreeningGuildSettings> = {},
): ScreeningGuildSettings {
  return {
    guildId: GUILD,
    logChannelId: "300000000000000001",
    ...SCREENING_DEFAULTS,
    rules: null,
    enabledBy: "400000000000000001",
    enabledAt: new Date("2026-03-01T00:00:00Z"),
    ...overrides,
  };
}

describe("DrizzleScreeningGuildRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let now: number;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(schema.screeningGuildsInAppPublic);
    now = 1_000_000;
  });

  function newRepo(): DrizzleScreeningGuildRepository {
    return new DrizzleScreeningGuildRepository(db, logger, () => now);
  }

  test("upsert inserts, replaces and round-trips settings", async () => {
    const repo = newRepo();

    const created = await repo.upsert(settings());
    expect(created).toEqual(settings());

    const updated = await repo.upsert(
      settings({
        logChannelId: null,
        rules: ["scam", "sale"],
        reviewThreshold: 0.55,
      }),
    );
    expect(updated.logChannelId).toBeNull();
    expect(updated.rules).toEqual(["scam", "sale"]);
    expect(updated.reviewThreshold).toBe(0.55);
    expect(await repo.list()).toEqual([updated]);
  });

  test("findByGuildId reflects upsert and delete right away", async () => {
    const repo = newRepo();
    expect(await repo.findByGuildId(GUILD)).toBeNull();

    await repo.upsert(settings());
    expect((await repo.findByGuildId(GUILD))?.maxMessages).toBe(20);

    await repo.upsert(settings({ maxMessages: 5 }));
    expect((await repo.findByGuildId(GUILD))?.maxMessages).toBe(5);

    expect(await repo.delete(GUILD)).toBe(true);
    expect(await repo.findByGuildId(GUILD)).toBeNull();
    expect(await repo.delete(GUILD)).toBe(false);
  });

  test("snapshot is reused for 60s, then refreshed", async () => {
    const repo = newRepo();
    expect(await repo.findByGuildId(GUILD)).toBeNull();

    // Written by another process: this repository's snapshot doesn't see it yet.
    await newRepo().upsert(settings());

    now += 59_000;
    expect(await repo.findByGuildId(GUILD)).toBeNull();

    now += 1_000;
    expect((await repo.findByGuildId(GUILD))?.guildId).toBe(GUILD);
  });

  test("concurrent lookups share one refresh", async () => {
    const repo = newRepo();
    await newRepo().upsert(settings());

    let listCalls = 0;
    const originalList = repo.list.bind(repo);
    repo.list = async () => {
      listCalls += 1;
      return originalList();
    };

    const results = await Promise.all([
      repo.findByGuildId(GUILD),
      repo.findByGuildId(GUILD),
      repo.findByGuildId("100000000000000002"),
    ]);

    expect(listCalls).toBe(1);
    expect(results.map((r) => r?.guildId ?? null)).toEqual([
      GUILD,
      GUILD,
      null,
    ]);
  });

  test("refresh failures serve the last snapshot and retry after 5s", async () => {
    const repo = newRepo();
    await repo.upsert(settings());

    let listCalls = 0;
    let failing = true;
    const originalList = repo.list.bind(repo);
    repo.list = async () => {
      listCalls += 1;
      if (failing) {
        throw new Error("db down");
      }
      return originalList();
    };

    now += 60_000;
    expect((await repo.findByGuildId(GUILD))?.guildId).toBe(GUILD);
    expect(listCalls).toBe(1);

    now += 4_000;
    expect((await repo.findByGuildId(GUILD))?.guildId).toBe(GUILD);
    expect(listCalls).toBe(1);

    now += 1_000;
    failing = false;
    await repo.findByGuildId(GUILD);
    expect(listCalls).toBe(2);
  });

  test("refresh failure with no snapshot throws", async () => {
    const repo = newRepo();
    repo.list = async () => {
      throw new Error("db down");
    };

    await expect(repo.findByGuildId(GUILD)).rejects.toThrow("db down");
    // A write still succeeds even though no snapshot could be loaded.
    expect((await repo.upsert(settings())).guildId).toBe(GUILD);
  });

  test("failed initial load is not retried for 5s", async () => {
    const repo = newRepo();
    await newRepo().upsert(settings());

    let listCalls = 0;
    let failing = true;
    const originalList = repo.list.bind(repo);
    repo.list = async () => {
      listCalls += 1;
      if (failing) {
        throw new Error("db down");
      }
      return originalList();
    };

    await expect(repo.findByGuildId(GUILD)).rejects.toThrow("db down");
    now += 4_000;
    failing = false;
    await expect(repo.findByGuildId(GUILD)).rejects.toThrow("db down");
    expect(listCalls).toBe(1);

    now += 1_000;
    expect((await repo.findByGuildId(GUILD))?.guildId).toBe(GUILD);
    expect(listCalls).toBe(2);
  });

  test("upsert and delete succeed and update the snapshot when the follow-up refresh fails", async () => {
    const repo = newRepo();
    await repo.upsert(settings());

    repo.list = async () => {
      throw new Error("db down");
    };

    const updated = await repo.upsert(settings({ maxMessages: 7 }));
    expect(updated.maxMessages).toBe(7);
    expect((await repo.findByGuildId(GUILD))?.maxMessages).toBe(7);

    expect(await repo.delete(GUILD)).toBe(true);
    expect(await repo.findByGuildId(GUILD)).toBeNull();
  });
});
