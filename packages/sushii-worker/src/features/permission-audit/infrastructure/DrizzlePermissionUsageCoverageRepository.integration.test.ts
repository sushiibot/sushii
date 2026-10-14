import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { permissionUsageCoverageInAppPublic } from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { DrizzlePermissionUsageCoverageRepository } from "./DrizzlePermissionUsageCoverageRepository";
import { DrizzlePermissionUsageRepository } from "./DrizzlePermissionUsageRepository";

const GUILD_ID = "111111111111111111";
const LONG_AGO = new Date("2000-01-01T00:00:00Z");
const FAR_FUTURE = new Date("2100-01-01T00:00:00Z");

describe("DrizzlePermissionUsageCoverageRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzlePermissionUsageCoverageRepository;
  let usageRepo: DrizzlePermissionUsageRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzlePermissionUsageCoverageRepository(db);
    usageRepo = new DrizzlePermissionUsageRepository(db);
  });

  beforeEach(async () => {
    await db.delete(permissionUsageCoverageInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  test("claims a guild live tracking already created", async () => {
    const startedAt = new Date("2026-10-01T00:00:00Z");
    await usageRepo.ensureTrackingStarted(GUILD_ID, startedAt);

    const claimed = await repo.claimBackfill(GUILD_ID, LONG_AGO);

    expect(claimed).toEqual(startedAt);
  });

  test("claims a guild with no row yet", async () => {
    const claimed = await repo.claimBackfill(GUILD_ID, LONG_AGO);

    expect(claimed).toBeInstanceOf(Date);
    expect(await repo.get(GUILD_ID)).not.toBeNull();
  });

  test("a fresh claim blocks a second claim", async () => {
    await repo.claimBackfill(GUILD_ID, LONG_AGO);

    expect(await repo.claimBackfill(GUILD_ID, LONG_AGO)).toBeNull();
  });

  test("a stale claim can be taken over", async () => {
    await repo.claimBackfill(GUILD_ID, LONG_AGO);

    expect(await repo.claimBackfill(GUILD_ID, FAR_FUTURE)).not.toBeNull();
  });

  test("a completed backfill is never claimed again", async () => {
    await repo.claimBackfill(GUILD_ID, LONG_AGO);
    await repo.completeBackfill(GUILD_ID, {
      "22": new Date("2026-08-29T00:00:00Z"),
    });

    expect(await repo.claimBackfill(GUILD_ID, FAR_FUTURE)).toBeNull();

    const coverage = await repo.get(GUILD_ID);
    expect(coverage?.backfilledAt).toBeInstanceOf(Date);
    expect(coverage?.backfillCoverage).toEqual({
      "22": new Date("2026-08-29T00:00:00Z"),
    });
  });

  test("a released claim can be claimed again", async () => {
    await repo.claimBackfill(GUILD_ID, LONG_AGO);
    await repo.releaseBackfillClaim(GUILD_ID);

    expect(await repo.claimBackfill(GUILD_ID, LONG_AGO)).not.toBeNull();
  });
});
