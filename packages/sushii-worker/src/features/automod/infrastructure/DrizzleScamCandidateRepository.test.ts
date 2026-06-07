import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";
import * as schema from "@/infrastructure/database/schema";

import { DrizzleScamCandidateRepository } from "./DrizzleScamCandidateRepository";

describe("DrizzleScamCandidateRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleScamCandidateRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleScamCandidateRepository(db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function insertClaimed(key: string, guildIds: string[]): Promise<void> {
    await repo.claimByHashKey(key, crypto.randomUUID(), "100000000000000001", 1, guildIds, "threshold");
  }

  describe("appendSeenUser", () => {
    beforeEach(async () => {
      await db.delete(schema.scamCandidateStateInAppPublic);
    });

    test("appends a new user with a single guild ID", async () => {
      await insertClaimed("key1", ["111111111111111111"]);

      const result = await repo.appendSeenUser("key1", "200000000000000002", 2, ["222222222222222222"]);

      expect(result).not.toBeNull();
      expect(result!.seenByUserIds).toContain("200000000000000002");
      expect(result!.guildIds).toContain("222222222222222222");
      expect(result!.channelCount).toBe(2);
    });

    test("appends a new user with multiple guild IDs", async () => {
      await insertClaimed("key2", ["111111111111111111"]);

      const result = await repo.appendSeenUser("key2", "200000000000000002", 3, [
        "222222222222222222",
        "333333333333333333",
      ]);

      expect(result).not.toBeNull();
      expect(result!.guildIds).toContain("222222222222222222");
      expect(result!.guildIds).toContain("333333333333333333");
      expect(result!.channelCount).toBe(3);
    });

    test("deduplicates guild IDs already present", async () => {
      await insertClaimed("key3", ["111111111111111111", "222222222222222222"]);

      const result = await repo.appendSeenUser("key3", "200000000000000002", 1, [
        "111111111111111111",
        "333333333333333333",
      ]);

      expect(result).not.toBeNull();
      const guildIds = result!.guildIds;
      expect(guildIds.filter((id) => id === "111111111111111111").length).toBe(1);
      expect(guildIds).toContain("222222222222222222");
      expect(guildIds).toContain("333333333333333333");
    });

    test("deduplicates seen user IDs", async () => {
      await insertClaimed("key4", ["111111111111111111"]);

      await repo.appendSeenUser("key4", "100000000000000001", 1, ["111111111111111111"]);
      const result = await repo.appendSeenUser("key4", "100000000000000001", 1, ["111111111111111111"]);

      expect(result).not.toBeNull();
      expect(result!.seenByUserIds.filter((id) => id === "100000000000000001").length).toBe(1);
    });

    test("takes the greater channel count", async () => {
      await insertClaimed("key5", ["111111111111111111"]);

      const r1 = await repo.appendSeenUser("key5", "200000000000000002", 10, ["222222222222222222"]);
      expect(r1!.channelCount).toBe(10);

      const r2 = await repo.appendSeenUser("key5", "300000000000000003", 5, ["333333333333333333"]);
      expect(r2!.channelCount).toBe(10);
    });

    test("returns null for unknown key", async () => {
      const result = await repo.appendSeenUser("nonexistent", "200000000000000002", 1, ["111111111111111111"]);
      expect(result).toBeNull();
    });
  });
});
