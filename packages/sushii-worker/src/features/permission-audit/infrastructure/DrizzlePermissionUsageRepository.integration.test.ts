import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  permissionUsageCoverageInAppPublic,
  permissionUsageInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { PermissionUsage } from "../domain/PermissionUsage";
import { DrizzlePermissionUsageRepository } from "./DrizzlePermissionUsageRepository";

const GUILD_A = "111111111111111111";
const GUILD_B = "999999999999999999";
const MOD_ID = "222222222222222222";
const CHANNEL_1 = "333333333333333333";
const CHANNEL_2 = "444444444444444444";

function usage(overrides: Partial<PermissionUsage>): PermissionUsage {
  return {
    guildId: GUILD_A,
    userId: MOD_ID,
    permission: "BanMembers",
    source: "audit_log",
    channelId: null,
    occurredAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

describe("DrizzlePermissionUsageRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzlePermissionUsageRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzlePermissionUsageRepository(db);
  });

  beforeEach(async () => {
    await db.delete(permissionUsageInAppPublic);
    await db.delete(permissionUsageCoverageInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  test("merges duplicate keys within one batch", async () => {
    await repo.record([
      usage({ occurredAt: new Date("2026-10-02T00:00:00Z") }),
      usage({ occurredAt: new Date("2026-10-01T00:00:00Z") }),
    ]);

    const rows = await db.select().from(permissionUsageInAppPublic);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.useCount).toBe(2n);
    expect(rows[0]?.firstUsedAt).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(rows[0]?.lastUsedAt).toEqual(new Date("2026-10-02T00:00:00Z"));
  });

  test("keeps the widest window across upserts", async () => {
    await repo.record([
      usage({
        occurredAt: new Date("2026-10-05T00:00:00Z"),
        channelId: CHANNEL_1,
      }),
    ]);
    await repo.record([
      usage({
        occurredAt: new Date("2026-09-01T00:00:00Z"),
        channelId: CHANNEL_2,
      }),
    ]);

    const [row] = await db.select().from(permissionUsageInAppPublic);
    expect(row?.firstUsedAt).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(row?.lastUsedAt).toEqual(new Date("2026-10-05T00:00:00Z"));
    expect(row?.channelId).toBe(BigInt(CHANNEL_1));
    expect(row?.useCount).toBe(2n);
  });

  test("keeps sources separate", async () => {
    await repo.record([
      usage({ source: "audit_log" }),
      usage({ source: "sushii_action" }),
    ]);

    const rows = await db.select().from(permissionUsageInAppPublic);
    expect(rows).toHaveLength(2);
  });

  test("first tracking start wins", async () => {
    await repo.ensureTrackingStarted(GUILD_A, new Date("2026-10-01T00:00:00Z"));
    await repo.ensureTrackingStarted(GUILD_A, new Date("2026-10-09T00:00:00Z"));

    const [row] = await db.select().from(permissionUsageCoverageInAppPublic);
    expect(row?.trackingStartedAt).toEqual(new Date("2026-10-01T00:00:00Z"));
  });

  test("prunes rows last used before the cutoff", async () => {
    await repo.record([
      usage({
        permission: "BanMembers",
        occurredAt: new Date("2026-07-01T00:00:00Z"),
      }),
      usage({
        permission: "KickMembers",
        occurredAt: new Date("2026-10-01T00:00:00Z"),
      }),
    ]);

    const deleted = await repo.deleteLastUsedBefore(
      new Date("2026-08-01T00:00:00Z"),
    );

    const rows = await db.select().from(permissionUsageInAppPublic);
    expect(deleted).toBe(1);
    expect(rows.map((row) => row.permission)).toEqual(["KickMembers"]);
  });

  test("deleteGuild only removes that guild", async () => {
    await repo.record([
      usage({ guildId: GUILD_A }),
      usage({ guildId: GUILD_B }),
    ]);
    await repo.ensureTrackingStarted(GUILD_A, new Date());
    await repo.ensureTrackingStarted(GUILD_B, new Date());

    await repo.deleteGuild(GUILD_A);

    const usageRows = await db.select().from(permissionUsageInAppPublic);
    const coverageRows = await db
      .select()
      .from(permissionUsageCoverageInAppPublic);
    expect(usageRows.map((row) => row.guildId)).toEqual([BigInt(GUILD_B)]);
    expect(coverageRows.map((row) => row.guildId)).toEqual([BigInt(GUILD_B)]);
  });
});
