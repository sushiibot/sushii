import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pino } from "pino";
import type { Logger } from "pino";

import { modLogsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { ModerationCase } from "../../domain/entities/ModerationCase";
import { ActionType } from "../../domain/value-objects/ActionType";
import { DrizzleModLogRepository } from "./DrizzleModLogRepository";

function makeCase(guildId: string, userId: string): ModerationCase {
  return ModerationCase.create(
    guildId,
    "0",
    ActionType.Warn,
    userId,
    "TestUser#0001",
    null,
    null,
  );
}

describe("DrizzleModLogRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleModLogRepository;
  let logger: Logger;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    logger = pino({ level: "silent" });
    repo = new DrizzleModLogRepository(db, logger);
  });

  beforeEach(async () => {
    await db.delete(modLogsInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("createCase", () => {
    test("assigns case_id starting at 1 for a new guild", async () => {
      const result = await repo.createCase(makeCase("111111111111111111", "222222222222222222"));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.caseId).toBe("1");
      }
    });

    test("assigns sequential case_ids for the same guild", async () => {
      const guildId = "111111111111111111";
      const userId = "222222222222222222";

      const r1 = await repo.createCase(makeCase(guildId, userId));
      const r2 = await repo.createCase(makeCase(guildId, userId));
      const r3 = await repo.createCase(makeCase(guildId, userId));

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(true);
      if (r1.ok && r2.ok && r3.ok) {
        expect([r1.val.caseId, r2.val.caseId, r3.val.caseId]).toEqual(["1", "2", "3"]);
      }
    });

    test("case_ids are independent across guilds", async () => {
      const guild1 = "111111111111111111";
      const guild2 = "333333333333333333";
      const userId = "222222222222222222";

      const r1 = await repo.createCase(makeCase(guild1, userId));
      const r2 = await repo.createCase(makeCase(guild2, userId));
      const r3 = await repo.createCase(makeCase(guild1, userId));

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(true);
      if (r1.ok && r2.ok && r3.ok) {
        expect(r1.val.caseId).toBe("1");
        expect(r2.val.caseId).toBe("1");
        expect(r3.val.caseId).toBe("2");
      }
    });

    test(
      // With a single DB connection, this test verifies sequential correctness under async
      // scheduling concurrency (Promise.all interleaving microtasks), not true multi-connection
      // contention. The advisory lock in the DB handles that case at the DB level.
      "Promise.all inserts for the same guild produce distinct sequential case_ids",
      async () => {
        const guildId = "111111111111111111";
        const userId = "222222222222222222";

        const results = await Promise.all(
          Array.from({ length: 5 }, () => repo.createCase(makeCase(guildId, userId))),
        );

        expect(results.every((r) => r.ok)).toBe(true);

        const caseIds = results
          .map((r) => (r.ok ? Number(r.val.caseId) : -1))
          .sort((a, b) => a - b);

        expect(new Set(caseIds).size).toBe(caseIds.length);
        expect(caseIds).toEqual([1, 2, 3, 4, 5]);
      },
    );

    test("respects external transaction", async () => {
      const guildId = "111111111111111111";
      const userId = "222222222222222222";

      let createdCaseId: string | undefined;

      await db.transaction(async (tx) => {
        const result = await repo.createCase(makeCase(guildId, userId), tx);
        expect(result.ok).toBe(true);
        if (result.ok) {
          createdCaseId = result.val.caseId;
        }
      });

      expect(createdCaseId).toBe("1");

      const rows = await db.select().from(modLogsInAppPublic);
      expect(rows).toHaveLength(1);
    });
  });
});
