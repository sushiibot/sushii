import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { FeedbackService } from "../application/FeedbackService";
import type { Feedback, NewFeedback } from "../domain/Feedback";
import { DrizzleFeedbackRepository } from "./DrizzleFeedbackRepository";
import type { FeedbackMetrics } from "./FeedbackMetrics";

const USER_ID = "150443906511667200";
const OTHER_USER_ID = "150443906511667201";
const GUILD_ID = "167058919611564043";
const NO_LIMIT = 1_000;
const HOUR_SECONDS = 60 * 60;

function newFeedback(overrides: Partial<NewFeedback> = {}): NewFeedback {
  return {
    userId: USER_ID,
    guildId: GUILD_ID,
    source: "panel",
    kind: "idea",
    feature: "settings.logging",
    traceId: null,
    content: "Separate channels for bans and timeouts please",
    ...overrides,
  };
}

describe("DrizzleFeedbackRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleFeedbackRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleFeedbackRepository(db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  async function insert(feedback: NewFeedback): Promise<Feedback> {
    const saved = await repo.insertWithinLimit(
      feedback,
      NO_LIMIT,
      HOUR_SECONDS,
    );
    if (!saved) {
      throw new Error("insert unexpectedly rate limited");
    }
    return saved;
  }

  async function rowCount(userId: string): Promise<number> {
    const rows = await db
      .select()
      .from(schema.feedbackInAppPublic)
      .where(eq(schema.feedbackInAppPublic.userId, BigInt(userId)));
    return rows.length;
  }

  beforeEach(async () => {
    await db.delete(schema.feedbackInAppPublic);
  });

  test("insert round-trips every field", async () => {
    const saved = await insert(
      newFeedback({
        guildId: null,
        source: "error_report",
        kind: "broken",
        feature: null,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      }),
    );

    expect(saved).toEqual({
      id: expect.any(Number),
      userId: USER_ID,
      guildId: null,
      source: "error_report",
      kind: "broken",
      feature: null,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      content: "Separate channels for bans and timeouts please",
      createdAt: expect.any(Date),
    });
  });

  test("insertWithinLimit refuses once the user reaches the limit", async () => {
    const insert = (f: NewFeedback) =>
      repo.insertWithinLimit(f, 2, HOUR_SECONDS);

    expect(await insert(newFeedback())).not.toBeNull();
    expect(await insert(newFeedback())).not.toBeNull();
    expect(await insert(newFeedback())).toBeNull();
    expect(await insert(newFeedback({ userId: OTHER_USER_ID }))).not.toBeNull();
    expect(await rowCount(USER_ID)).toBe(2);
  });

  test("insertWithinLimit ignores rows older than the window", async () => {
    const old = await insert(newFeedback());
    await db
      .update(schema.feedbackInAppPublic)
      .set({ createdAt: sql`now() - interval '1 hour 1 second'` })
      .where(eq(schema.feedbackInAppPublic.id, old.id));

    expect(
      await repo.insertWithinLimit(newFeedback(), 1, HOUR_SECONDS),
    ).not.toBeNull();
    expect(
      await repo.insertWithinLimit(newFeedback(), 1, HOUR_SECONDS),
    ).toBeNull();
  });

  test("concurrent submits for one user store exactly the limit", async () => {
    // The shared test client is a single connection, so real contention needs a pool.
    const pool = new Pool({
      connectionString: testDb.getConnectionString(),
      max: 8,
    });
    const metrics = Object.create(null) as FeedbackMetrics;
    Object.assign(metrics, { submissions: { add: mock(() => undefined) } });
    const service = new FeedbackService(
      new DrizzleFeedbackRepository(drizzle({ client: pool, schema })),
      { publish: mock(() => Promise.resolve("published" as const)) },
      metrics,
      { warn: mock(() => undefined) } as unknown as Logger,
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.submit({
          ...newFeedback(),
          reporter: { username: "tzuyu", guildName: "ONCE" },
        }),
      ),
    ).finally(() => pool.end());

    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => r.err)).toHaveLength(5);
    expect(await rowCount(USER_ID)).toBe(3);
  });
});
