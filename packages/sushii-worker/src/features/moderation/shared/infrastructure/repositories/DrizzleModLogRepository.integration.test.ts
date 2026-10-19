import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pino } from "pino";
import type { Logger } from "pino";

import { modLogsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import type { ModerationCase } from "../../domain/entities/ModerationCase";
import { DrizzleModLogRepository } from "./DrizzleModLogRepository";

function makeCase(guildId: string, userId: string): ModerationCase {
  return makeModerationCase({ guildId, userId });
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
      const result = await repo.createCase(
        makeCase("111111111111111111", "222222222222222222"),
      );

      expect(result.caseId).toBe("1");
    });

    test("assigns sequential case_ids for the same guild", async () => {
      const guildId = "111111111111111111";
      const userId = "222222222222222222";

      const r1 = await repo.createCase(makeCase(guildId, userId));
      const r2 = await repo.createCase(makeCase(guildId, userId));
      const r3 = await repo.createCase(makeCase(guildId, userId));

      expect([r1.caseId, r2.caseId, r3.caseId]).toEqual(["1", "2", "3"]);
    });

    test("case_ids are independent across guilds", async () => {
      const guild1 = "111111111111111111";
      const guild2 = "333333333333333333";
      const userId = "222222222222222222";

      const r1 = await repo.createCase(makeCase(guild1, userId));
      const r2 = await repo.createCase(makeCase(guild2, userId));
      const r3 = await repo.createCase(makeCase(guild1, userId));

      expect(r1.caseId).toBe("1");
      expect(r2.caseId).toBe("1");
      expect(r3.caseId).toBe("2");
    });

    test(// With a single DB connection, this test verifies sequential correctness under async
    // scheduling concurrency (Promise.all interleaving microtasks), not true multi-connection
    // contention. The advisory lock in the DB handles that case at the DB level.
    "Promise.all inserts for the same guild produce distinct sequential case_ids", async () => {
      const guildId = "111111111111111111";
      const userId = "222222222222222222";

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          repo.createCase(makeCase(guildId, userId)),
        ),
      );

      const caseIds = results
        .map((r) => Number(r.caseId))
        .sort((a, b) => a - b);

      expect(new Set(caseIds).size).toBe(caseIds.length);
      expect(caseIds).toEqual([1, 2, 3, 4, 5]);
    });

    test("respects external transaction", async () => {
      const guildId = "111111111111111111";
      const userId = "222222222222222222";

      let createdCaseId: string | undefined;

      await db.transaction(async (tx) => {
        const result = await repo.createCase(makeCase(guildId, userId), tx);
        createdCaseId = result.caseId;
      });

      expect(createdCaseId).toBe("1");

      const rows = await db.select().from(modLogsInAppPublic);
      expect(rows).toHaveLength(1);
    });
  });
});
