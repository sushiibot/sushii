import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pino } from "pino";
import type { Logger } from "pino";

import { normalizeReason } from "@/features/moderation/shared/domain/value-objects/normalizeReason";
import { modLogsInAppPublic } from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";
import { makeModerationCase } from "@/test/fixtures/moderationCase";

import type { ModerationCase } from "../../domain/entities/ModerationCase";
import { DrizzleModLogRepository } from "./DrizzleModLogRepository";

const GUILD_ID = "111111111111111111";
const OTHER_GUILD_ID = "333333333333333333";
const USER_ID = "222222222222222222";
const EXECUTOR_ID = "444444444444444444";
const SETTER_ID = "555555555555555555";

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

  describe("reason queries", () => {
    async function insertCase(
      guildId: string,
      reason: string | null,
      actionTime: Date,
      executorId: string | null = EXECUTOR_ID,
    ): Promise<ModerationCase> {
      const created = await repo.createCase(
        makeModerationCase({ guildId, userId: USER_ID, reason, executorId }),
      );
      await db
        .update(modLogsInAppPublic)
        .set({ actionTime })
        .where(
          and(
            eq(modLogsInAppPublic.guildId, BigInt(guildId)),
            eq(modLogsInAppPublic.caseId, BigInt(created.caseId)),
          ),
        );

      return created;
    }

    test("findLastReason returns the newest case with a reason", async () => {
      await insertCase(
        GUILD_ID,
        "Old reason",
        new Date("2026-01-01T00:00:00Z"),
      );
      const newest = await insertCase(
        GUILD_ID,
        "Newest reason",
        new Date("2026-01-03T00:00:00Z"),
      );
      await insertCase(GUILD_ID, null, new Date("2026-01-04T00:00:00Z"));
      await insertCase(GUILD_ID, "   ", new Date("2026-01-05T00:00:00Z"));
      await insertCase(GUILD_ID, "\n", new Date("2026-01-05T00:00:00Z"));
      await insertCase(GUILD_ID, "\t ", new Date("2026-01-05T00:00:00Z"));
      await insertCase(
        OTHER_GUILD_ID,
        "Other guild",
        new Date("2026-01-06T00:00:00Z"),
      );

      expect(await repo.findLastReason(GUILD_ID)).toEqual({
        caseId: newest.caseId,
        reason: "Newest reason",
        executorId: EXECUTOR_ID,
        actionTime: new Date("2026-01-03T00:00:00Z"),
      });
    });

    test("findLastReason returns null without reasons", async () => {
      await insertCase(GUILD_ID, null, new Date("2026-01-01T00:00:00Z"));

      expect(await repo.findLastReason(GUILD_ID)).toBeNull();
    });

    test("findRecentDistinctReasons dedupes by normalized reason, newest first", async () => {
      await insertCase(GUILD_ID, "Spam link", new Date("2026-01-01T00:00:00Z"));
      const raid = await insertCase(
        GUILD_ID,
        "Raid",
        new Date("2026-01-02T00:00:00Z"),
      );
      const spam = await insertCase(
        GUILD_ID,
        "SPAM   link",
        new Date("2026-01-03T00:00:00Z"),
      );
      await insertCase(GUILD_ID, null, new Date("2026-01-04T00:00:00Z"));
      await insertCase(GUILD_ID, "\n", new Date("2026-01-04T00:00:00Z"));
      await insertCase(GUILD_ID, "\t ", new Date("2026-01-04T00:00:00Z"));
      const nsfw = await insertCase(
        GUILD_ID,
        "NSFW",
        new Date("2026-01-05T00:00:00Z"),
      );
      await insertCase(
        OTHER_GUILD_ID,
        "Other",
        new Date("2026-01-06T00:00:00Z"),
      );

      expect(await repo.findRecentDistinctReasons(GUILD_ID, 10)).toEqual([
        { caseId: nsfw.caseId, reason: "NSFW" },
        { caseId: spam.caseId, reason: "SPAM   link" },
        { caseId: raid.caseId, reason: "Raid" },
      ]);
      expect(await repo.findRecentDistinctReasons(GUILD_ID, 2)).toHaveLength(2);
    });

    test("countByNormalizedReason matches normalizeReason and respects the cap", async () => {
      const time = new Date("2026-01-01T00:00:00Z");
      await insertCase(GUILD_ID, "\n\tSpam   LINK  ", time);
      await insertCase(GUILD_ID, "spam link", time);
      await insertCase(GUILD_ID, "SPAM\nlink", time);
      await insertCase(GUILD_ID, "spam links", time);
      await insertCase(GUILD_ID, null, time);
      await insertCase(OTHER_GUILD_ID, "spam link", time);

      const key = normalizeReason("  Spam\t link ");
      expect(await repo.countByNormalizedReason(GUILD_ID, key, 10)).toBe(3);
      expect(await repo.countByNormalizedReason(GUILD_ID, key, 2)).toBe(2);
      expect(await repo.countByNormalizedReason(GUILD_ID, "nothing", 10)).toBe(
        0,
      );
    });
  });

  describe("countByNormalizedReason scan window", () => {
    test("only counts within the guild's newest 500 cases", async () => {
      const base = new Date("2026-01-01T00:00:00Z").getTime();
      const values = Array.from({ length: 502 }, (_, i) => ({
        guildId: BigInt(GUILD_ID),
        caseId: BigInt(i + 1),
        action: "warn",
        actionTime: new Date(base + i * 1000),
        pending: false,
        userId: BigInt(USER_ID),
        userTag: "user",
        // The two oldest cases carry the reason; the rest are newer.
        reason: i < 2 ? "Old spam" : "Other",
      }));
      await db.insert(modLogsInAppPublic).values(values);

      expect(await repo.countByNormalizedReason(GUILD_ID, "old spam", 10)).toBe(
        0,
      );
      expect(await repo.countByNormalizedReason(GUILD_ID, "other", 3)).toBe(3);
    });
  });

  describe("case updates", () => {
    test("updateReasonBulk sets reason and setter without touching executor", async () => {
      await repo.createCase(
        makeModerationCase({
          guildId: GUILD_ID,
          userId: USER_ID,
          executorId: EXECUTOR_ID,
        }),
      );
      await repo.createCase(
        makeModerationCase({
          guildId: GUILD_ID,
          userId: USER_ID,
          executorId: EXECUTOR_ID,
          reason: "Existing",
        }),
      );

      const before = Date.now();
      const updated = await repo.updateReasonBulk(
        GUILD_ID,
        SETTER_ID,
        1,
        2,
        "New reason",
        true,
      );

      expect(updated).toHaveLength(1);
      expect(updated[0]?.caseId).toBe("1");
      expect(updated[0]?.reason?.value).toBe("New reason");
      expect(updated[0]?.executorId).toBe(EXECUTOR_ID);
      expect(updated[0]?.reasonSetBy).toBe(SETTER_ID);
      expect(updated[0]?.reasonSetAt?.getTime()).toBeGreaterThanOrEqual(
        before - 1000,
      );

      const untouched = await repo.findById(GUILD_ID, "2");
      expect(untouched?.reason?.value).toBe("Existing");
      expect(untouched?.reasonSetBy).toBeNull();

      const all = await repo.updateReasonBulk(
        GUILD_ID,
        SETTER_ID,
        1,
        2,
        "Overwrite",
        false,
      );
      expect(all.map((c) => c.reason?.value)).toEqual([
        "Overwrite",
        "Overwrite",
      ]);
      expect(all.every((c) => c.executorId === EXECUTOR_ID)).toBe(true);
    });

    test("update persists dmDeleted and reason setter", async () => {
      const created = await repo.createCase(makeCase(GUILD_ID, USER_ID));
      const at = new Date("2026-03-01T12:00:00Z");

      await repo.update(created.withDmDeleted().withReasonSetBy(SETTER_ID, at));

      const found = await repo.findById(GUILD_ID, created.caseId);
      expect(found?.dmDeleted).toBe(true);
      expect(found?.reasonSetBy).toBe(SETTER_ID);
      expect(found?.reasonSetAt).toEqual(at);
    });

    test("new cases default dmDeleted false and no setter", async () => {
      const created = await repo.createCase(makeCase(GUILD_ID, USER_ID));

      expect(created.dmDeleted).toBe(false);
      expect(created.reasonSetBy).toBeNull();
      expect(created.reasonSetAt).toBeNull();
    });

    test("markDmDeleted flags only the given case", async () => {
      const first = await repo.createCase(makeCase(GUILD_ID, USER_ID));
      const second = await repo.createCase(makeCase(GUILD_ID, USER_ID));

      const at = new Date("2026-10-27T12:00:00.000Z");
      await repo.markDmDeleted(
        GUILD_ID,
        first.caseId,
        "238381427315195904",
        at,
      );

      const marked = await repo.findById(GUILD_ID, first.caseId);
      expect(marked?.dmDeleted).toBe(true);
      expect(marked?.dmDeletedBy).toBe("238381427315195904");
      expect(marked?.dmDeletedAt).toEqual(at);
      const other = await repo.findById(GUILD_ID, second.caseId);
      expect(other?.dmDeleted).toBe(false);
      expect(other?.dmDeletedBy).toBeNull();
    });

    test("markDmDeleted without who or when, for old mod log entries", async () => {
      const created = await repo.createCase(makeCase(GUILD_ID, USER_ID));

      await repo.markDmDeleted(GUILD_ID, created.caseId, null, null);

      const marked = await repo.findById(GUILD_ID, created.caseId);
      expect(marked?.dmDeleted).toBe(true);
      expect(marked?.dmDeletedBy).toBeNull();
      expect(marked?.dmDeletedAt).toBeNull();
    });

    test("update persists who deleted the DM", async () => {
      const created = await repo.createCase(makeCase(GUILD_ID, USER_ID));
      const at = new Date("2026-10-27T12:00:00.000Z");

      await repo.update(created.withDmDeleted("238381427315195904", at));

      const found = await repo.findById(GUILD_ID, created.caseId);
      expect(found?.dmDeletedBy).toBe("238381427315195904");
      expect(found?.dmDeletedAt).toEqual(at);
    });

    test("findByIds returns the requested cases in the guild", async () => {
      await repo.createCase(makeCase(GUILD_ID, USER_ID));
      await repo.createCase(makeCase(GUILD_ID, USER_ID));
      await repo.createCase(makeCase(GUILD_ID, USER_ID));
      await repo.createCase(makeCase(OTHER_GUILD_ID, USER_ID));

      const found = await repo.findByIds(GUILD_ID, ["3", "1", "9"]);

      expect(found.map((c) => c.caseId)).toEqual(["1", "3"]);
      expect(found.every((c) => c.guildId === GUILD_ID)).toBe(true);
      expect(await repo.findByIds(GUILD_ID, [])).toEqual([]);
      expect(
        (await repo.findByIds(GUILD_ID, ["abc", "1", "1e3"])).map(
          (c) => c.caseId,
        ),
      ).toEqual(["1"]);
    });
  });
});
