import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";

import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { FeatureFlagEntry } from "../domain/FeatureFlag";
import { DrizzleFeatureFlagRepository } from "./DrizzleFeatureFlagRepository";

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const OWNER = "400000000000000001";
const FLAG = "member_screening";
const logger = pino({ level: "silent" });

describe("DrizzleFeatureFlagRepository", () => {
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
    await db.delete(schema.guildFeatureFlagsInAppPublic);
    now = Date.parse("2026-10-01T00:00:00Z");
  });

  function newRepo(): DrizzleFeatureFlagRepository {
    return new DrizzleFeatureFlagRepository(db, logger, () => now);
  }

  test("enable is idempotent and keeps the first enabler", async () => {
    const repo = newRepo();

    await repo.enable(GUILD, FLAG, OWNER);
    now += 1_000;
    await repo.enable(GUILD, FLAG, "400000000000000002");

    expect(await repo.listGuilds(FLAG)).toEqual([
      {
        guildId: GUILD,
        flag: FLAG,
        enabledBy: OWNER,
        enabledAt: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
  });

  test("listGuilds orders by enabled time", async () => {
    const repo = newRepo();

    await repo.enable(OTHER_GUILD, FLAG, OWNER);
    now += 1_000;
    await repo.enable(GUILD, FLAG, OWNER);

    expect((await repo.listGuilds(FLAG)).map((e) => e.guildId)).toEqual([
      OTHER_GUILD,
      GUILD,
    ]);
  });

  test("isEnabled reflects enable and disable right away", async () => {
    const repo = newRepo();
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(false);

    await repo.enable(GUILD, FLAG, OWNER);
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(true);
    expect(await repo.isEnabled(OTHER_GUILD, FLAG)).toBe(false);

    expect(await repo.disable(GUILD, FLAG)).toBe(true);
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(false);
    expect(await repo.disable(GUILD, FLAG)).toBe(false);
  });

  test("rejects unknown flags", async () => {
    const insert = async () => {
      await db.execute(
        sql`INSERT INTO app_public.guild_feature_flags (guild_id, flag, enabled_by, enabled_at) VALUES (1, 'nope', 1, now())`,
      );
    };

    await expect(insert()).rejects.toThrow();
  });

  test("snapshot is reused for 60s, then refreshed", async () => {
    const repo = newRepo();
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(false);

    // Written by another process: this repository's snapshot doesn't see it yet.
    await newRepo().enable(GUILD, FLAG, OWNER);

    now += 59_000;
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(false);

    now += 1_000;
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(true);
  });

  test("concurrent lookups share one refresh", async () => {
    const repo = newRepo();
    await newRepo().enable(GUILD, FLAG, OWNER);

    let loads = 0;
    const originalListAll = repo.listAll.bind(repo);
    repo.listAll = async () => {
      loads += 1;
      return originalListAll();
    };

    const results = await Promise.all([
      repo.isEnabled(GUILD, FLAG),
      repo.isEnabled(GUILD, FLAG),
      repo.isEnabled(OTHER_GUILD, FLAG),
    ]);

    expect(loads).toBe(1);
    expect(results).toEqual([true, true, false]);
  });

  test("refresh failures serve the last snapshot and retry after 5s", async () => {
    const repo = newRepo();
    await repo.enable(GUILD, FLAG, OWNER);

    let loads = 0;
    let failing = true;
    const originalListAll = repo.listAll.bind(repo);
    repo.listAll = async () => {
      loads += 1;
      if (failing) {
        throw new Error("db down");
      }
      return originalListAll();
    };

    now += 60_000;
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(true);
    expect(loads).toBe(1);

    now += 4_000;
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(true);
    expect(loads).toBe(1);

    now += 1_000;
    failing = false;
    await repo.isEnabled(GUILD, FLAG);
    expect(loads).toBe(2);
  });

  test("refresh failure with no snapshot throws", async () => {
    const repo = newRepo();
    repo.listAll = async () => {
      throw new Error("db down");
    };

    await expect(repo.isEnabled(GUILD, FLAG)).rejects.toThrow("db down");
    // A write still succeeds even though no snapshot could be loaded.
    await repo.enable(GUILD, FLAG, OWNER);
    expect(await repo.listGuilds(FLAG)).toHaveLength(1);
  });

  test("failed initial load is not retried for 5s", async () => {
    const repo = newRepo();
    await newRepo().enable(GUILD, FLAG, OWNER);

    let loads = 0;
    let failing = true;
    const originalListAll = repo.listAll.bind(repo);
    repo.listAll = async () => {
      loads += 1;
      if (failing) {
        throw new Error("db down");
      }
      return originalListAll();
    };

    await expect(repo.isEnabled(GUILD, FLAG)).rejects.toThrow("db down");
    now += 4_000;
    failing = false;
    await expect(repo.isEnabled(GUILD, FLAG)).rejects.toThrow("db down");
    expect(loads).toBe(1);

    now += 1_000;
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(true);
    expect(loads).toBe(2);
  });

  test("enable and disable update the snapshot when the follow-up refresh fails", async () => {
    const repo = newRepo();
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(false);

    repo.listAll = async () => {
      throw new Error("db down");
    };

    await repo.enable(GUILD, FLAG, OWNER);
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(true);

    expect(await repo.disable(GUILD, FLAG)).toBe(true);
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(false);
  });

  test("a write during an in-flight load isn't overwritten by the stale load", async () => {
    const repo = newRepo();

    const { promise: stale, resolve: releaseStale } =
      Promise.withResolvers<FeatureFlagEntry[]>();
    let loads = 0;
    repo.listAll = () => {
      loads += 1;
      if (loads === 1) {
        return stale;
      }
      // Without the in-flight guard this refresh runs first, and the stale load lands after it.
      releaseStale([]);
      return Promise.reject(new Error("db down"));
    };

    const staleLookup = repo.isEnabled(GUILD, FLAG);
    const write = repo.enable(GUILD, FLAG, OWNER);
    // With the guard, the write waits on the stale load, so release it after the insert.
    setTimeout(() => releaseStale([]), 50);

    expect(await staleLookup).toBe(false);
    await write;
    expect(await repo.isEnabled(GUILD, FLAG)).toBe(true);
  });
});
