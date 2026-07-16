import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";
import * as schema from "@/infrastructure/database/schema";

import { DrizzleScamImageHashRepository } from "./DrizzleScamImageHashRepository";

describe("DrizzleScamImageHashRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleScamImageHashRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleScamImageHashRepository(db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(schema.scamImageHashesInAppPublic);
  });

  describe("findById", () => {
    test("returns the entry when it exists", async () => {
      const id = await repo.add(123n, "test label", "scam-images/test.png");

      const entry = await repo.findById(id);

      expect(entry).not.toBeNull();
      expect(entry?.id).toBe(id);
      expect(entry?.label).toBe("test label");
      expect(entry?.s3Key).toBe("scam-images/test.png");
      expect(entry?.phash).toBe(123n);
    });

    test("returns null when the entry does not exist", async () => {
      const entry = await repo.findById(999999);

      expect(entry).toBeNull();
    });
  });
});
