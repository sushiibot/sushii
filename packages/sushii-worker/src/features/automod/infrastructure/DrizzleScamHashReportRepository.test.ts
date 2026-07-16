import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";
import * as schema from "@/infrastructure/database/schema";

import { DrizzleScamHashReportRepository } from "./DrizzleScamHashReportRepository";

describe("DrizzleScamHashReportRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleScamHashReportRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleScamHashReportRepository(db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(schema.scamHashReportsInAppPublic);
  });

  test("create starts a report in pending status", async () => {
    const id = await repo.create({
      hashId: 1,
      reporterId: "100000000000000001",
      guildId: "200000000000000001",
      guildName: "Test Guild",
    });

    const report = await repo.findById(id);

    expect(report?.status).toBe("pending");
    expect(report?.hashId).toBe(1);
    expect(report?.reviewMessageId).toBeNull();
  });

  test("getPendingRows only returns pending reports", async () => {
    const pendingId = await repo.create({
      hashId: 1,
      reporterId: "100000000000000001",
      guildId: "200000000000000001",
      guildName: "Test Guild",
    });
    const postedId = await repo.create({
      hashId: 2,
      reporterId: "100000000000000002",
      guildId: "200000000000000002",
      guildName: "Other Guild",
    });
    await repo.markPosted(postedId, "900000000000000001");

    const pending = await repo.getPendingRows();

    expect(pending.map((r) => r.id)).toEqual([pendingId]);
  });

  test("markPosted sets status and review message id", async () => {
    const id = await repo.create({
      hashId: 1,
      reporterId: "100000000000000001",
      guildId: "200000000000000001",
      guildName: "Test Guild",
    });

    await repo.markPosted(id, "900000000000000001");

    const report = await repo.findById(id);
    expect(report?.status).toBe("posted");
    expect(report?.reviewMessageId).toBe("900000000000000001");
  });

  test("resolve sets a terminal status from posted", async () => {
    const id = await repo.create({
      hashId: 1,
      reporterId: "100000000000000001",
      guildId: "200000000000000001",
      guildName: "Test Guild",
    });
    await repo.markPosted(id, "900000000000000001");

    const claimed = await repo.resolve(id, "reverted");

    expect(claimed).toBe(true);
    const report = await repo.findById(id);
    expect(report?.status).toBe("reverted");
  });

  test("resolve also claims a still-pending row — the review message can exist before markPosted lands", async () => {
    const id = await repo.create({
      hashId: 1,
      reporterId: "100000000000000001",
      guildId: "200000000000000001",
      guildName: "Test Guild",
    });

    const claimed = await repo.resolve(id, "reverted");

    expect(claimed).toBe(true);
    const report = await repo.findById(id);
    expect(report?.status).toBe("reverted");
  });

  test("resolve returns false and does not change status once already terminal", async () => {
    const id = await repo.create({
      hashId: 1,
      reporterId: "100000000000000001",
      guildId: "200000000000000001",
      guildName: "Test Guild",
    });
    await repo.markPosted(id, "900000000000000001");
    await repo.resolve(id, "dismissed");

    const claimed = await repo.resolve(id, "reverted");

    expect(claimed).toBe(false);
    const report = await repo.findById(id);
    expect(report?.status).toBe("dismissed");
  });

  test("resolve is race-safe — only the first of two concurrent resolutions wins", async () => {
    const id = await repo.create({
      hashId: 1,
      reporterId: "100000000000000001",
      guildId: "200000000000000001",
      guildName: "Test Guild",
    });
    await repo.markPosted(id, "900000000000000001");

    const [revertClaimed, dismissClaimed] = await Promise.all([
      repo.resolve(id, "reverted"),
      repo.resolve(id, "dismissed"),
    ]);

    expect([revertClaimed, dismissClaimed].filter(Boolean)).toHaveLength(1);
  });

  test("revertToPosted resets status back so a report stays retryable", async () => {
    const id = await repo.create({
      hashId: 1,
      reporterId: "100000000000000001",
      guildId: "200000000000000001",
      guildName: "Test Guild",
    });
    await repo.markPosted(id, "900000000000000001");
    await repo.resolve(id, "reverted");

    await repo.revertToPosted(id);

    const report = await repo.findById(id);
    expect(report?.status).toBe("posted");

    const claimed = await repo.resolve(id, "dismissed");
    expect(claimed).toBe(true);
  });

  describe("findActive", () => {
    test("returns a pending report for the same hash/reporter", async () => {
      const id = await repo.create({
        hashId: 1,
        reporterId: "100000000000000001",
        guildId: "200000000000000001",
        guildName: "Test Guild",
      });

      const active = await repo.findActive(1, "100000000000000001");

      expect(active?.id).toBe(id);
    });

    test("returns null once the report has reached a terminal state", async () => {
      const id = await repo.create({
        hashId: 1,
        reporterId: "100000000000000001",
        guildId: "200000000000000001",
        guildName: "Test Guild",
      });
      await repo.markPosted(id, "900000000000000001");
      await repo.resolve(id, "dismissed");

      const active = await repo.findActive(1, "100000000000000001");

      expect(active).toBeNull();
    });

    test("returns null for a different reporter", async () => {
      await repo.create({
        hashId: 1,
        reporterId: "100000000000000001",
        guildId: "200000000000000001",
        guildName: "Test Guild",
      });

      const active = await repo.findActive(1, "999999999999999999");

      expect(active).toBeNull();
    });
  });
});
