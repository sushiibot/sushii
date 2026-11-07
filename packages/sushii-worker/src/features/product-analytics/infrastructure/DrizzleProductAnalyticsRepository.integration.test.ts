import { sleep } from "bun";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { sql } from "drizzle-orm";
import type { Logger } from "pino";

import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { ProductAnalyticsService } from "../application/ProductAnalyticsService";
import { ProductRollupService } from "../application/ProductRollupService";
import { actorCode } from "../domain/ProductEvent";
import { DrizzleProductAnalyticsRepository } from "./DrizzleProductAnalyticsRepository";

const KEY = "k".repeat(32);
const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

const { productEventsInAppPublic: events } = schema;

describe("product analytics rollup", () => {
  const testDb = new PostgresTestDatabase();
  let db: Awaited<ReturnType<PostgresTestDatabase["initialize"]>>;
  let repository: DrizzleProductAnalyticsRepository;
  let rollup: ProductRollupService;

  async function seed(
    at: string,
    feature: string,
    users: number[],
    guildId = 100n,
  ) {
    await db.insert(events).values(
      users.map((user) => ({
        occurredAt: new Date(at),
        name: "interaction.command",
        feature,
        guildId: guildId + BigInt(user),
        actor: actorCode(KEY, String(user)),
      })),
    );
  }

  beforeAll(async () => {
    db = await testDb.initialize();
    repository = new DrizzleProductAnalyticsRepository(db);
    rollup = new ProductRollupService(repository, logger);
  });

  beforeEach(async () => {
    await db.execute(sql`
      TRUNCATE app_public.product_events, app_public.product_usage_weekly,
        app_public.product_retention_weekly, app_public.product_rollup_state
    `);
  });

  afterAll(async () => {
    await testDb.close();
  });

  test("writes usage, retention and an all row for closed weeks", async () => {
    await seed("2026-09-07T10:00:00Z", "social", [1, 2, 3, 4, 5, 6]);
    await seed("2026-09-14T10:00:00Z", "social", [1, 2, 3, 4, 5]);
    await seed("2026-09-21T10:00:00Z", "social", [1]);

    await rollup.run(new Date("2026-09-30T12:00:00Z"));

    const usage = await db.select().from(schema.productUsageWeeklyInAppPublic);
    expect(usage).toContainEqual({
      week: "2026-09-07",
      feature: "social",
      guilds: 6,
      actors: 6,
      events: 6,
    });
    expect(usage.map((row) => row.feature)).toContain("all");
    expect(usage.map((row) => row.week)).not.toContain("2026-09-21");

    const retention = await db
      .select()
      .from(schema.productRetentionWeeklyInAppPublic);
    expect(retention).toContainEqual({
      cohortWeek: "2026-09-07",
      unit: "user",
      feature: "social",
      weeksLater: 1,
      base: 6,
      retained: 5,
    });
    expect(retention).toContainEqual({
      cohortWeek: "2026-09-07",
      unit: "user",
      feature: "social",
      weeksLater: 2,
      base: 6,
      retained: null,
    });
    expect(
      retention.some((row) => row.unit === "guild" && row.feature === "social"),
    ).toBe(false);
  });

  test("fills a cohort's later weeks on later runs and after a stall", async () => {
    await seed("2026-09-07T10:00:00Z", "social", [1, 2, 3, 4, 5]);
    await rollup.run(new Date("2026-09-09T12:00:00Z"));

    await seed("2026-10-19T10:00:00Z", "social", [1, 2, 3, 4, 5]);
    await rollup.run(new Date("2026-11-04T12:00:00Z"));

    const retention = await db
      .select()
      .from(schema.productRetentionWeeklyInAppPublic);
    const week6 = retention.find(
      (row) =>
        row.cohortWeek === "2026-09-07" &&
        row.feature === "social" &&
        row.weeksLater === 6,
    );
    expect(week6?.retained).toBe(5);
  });

  test("deletes on age even when the rollup is behind", async () => {
    await seed("2026-06-01T10:00:00Z", "social", [1]);
    await seed("2026-11-01T10:00:00Z", "social", [2]);

    await rollup.run(new Date("2026-11-06T12:00:00Z"));

    const rows = await db.select().from(events);
    expect(rows).toHaveLength(1);
    const usage = await db.select().from(schema.productUsageWeeklyInAppPublic);
    expect(usage.map((row) => row.week)).not.toContain("2026-06-01");
  });

  test("still deletes when the rollup fails", async () => {
    await seed("2026-06-01T10:00:00Z", "social", [1]);
    const failing = new ProductRollupService(
      {
        withRollupLock: () => Promise.reject(new Error("rollup failed")),
        deleteOlderThan: repository.deleteOlderThan.bind(repository),
        oldestEventAt: repository.oldestEventAt.bind(repository),
      } as unknown as DrizzleProductAnalyticsRepository,
      logger,
    );

    await expect(failing.run(new Date("2026-11-06T12:00:00Z"))).rejects.toThrow(
      "rollup failed",
    );

    expect(await db.select().from(events)).toHaveLength(0);
  });

  test("deletes even if the rollup never finishes", async () => {
    await seed("2026-06-01T10:00:00Z", "social", [1]);
    const stuck = new ProductRollupService(
      {
        withRollupLock: () => new Promise<void>(() => undefined),
        deleteOlderThan: repository.deleteOlderThan.bind(repository),
        oldestEventAt: repository.oldestEventAt.bind(repository),
      } as unknown as DrizzleProductAnalyticsRepository,
      logger,
    );

    void stuck.run(new Date("2026-11-06T12:00:00Z"));
    await sleep(100);

    expect(await db.select().from(events)).toHaveLength(0);
  });

  test("a deletion request removes only that user's records", async () => {
    await seed("2026-11-01T10:00:00Z", "social", [1, 2]);
    await db.insert(schema.feedbackInAppPublic).values({
      userId: 1n,
      source: "panel",
      kind: "idea",
      content: "text",
    });
    await db
      .insert(schema.userPromptStatesInAppPublic)
      .values({ userId: 1n, promptId: "proof_intro" });

    const service = new ProductAnalyticsService(repository, KEY, logger);
    const deleted = await service.deleteUserData("1");

    expect(deleted).toEqual({ usageRecords: 1, feedback: 1, promptStates: 1 });
    expect(await db.select().from(events)).toHaveLength(1);
  });

  test("live views count today and hide small groups", async () => {
    const now = new Date().toISOString();
    await seed(now, "social", [1, 2, 3, 4, 5]);
    await seed(now, "tags", [6, 7]);

    for (const view of ["usage_daily", "usage_current_week"]) {
      const { rows } = await db.execute<{
        feature: string;
        guilds: number | null;
        actors: number | null;
        events: number;
      }>(sql.raw(`SELECT * FROM analytics.${view} ORDER BY feature`));

      expect(
        rows.map(({ feature, guilds, actors, events: count }) => ({
          feature,
          guilds,
          actors,
          count,
        })),
      ).toEqual([
        { feature: "all", guilds: 7, actors: 7, count: 7 },
        { feature: "social", guilds: 5, actors: 5, count: 5 },
      ]);
    }
  });

  test("live totals stay visible with the small counts hidden", async () => {
    await seed(new Date().toISOString(), "social", [1, 2]);

    const { rows } = await db.execute<{
      feature: string;
      guilds: number | null;
      actors: number | null;
      events: number;
    }>(sql`SELECT * FROM analytics.usage_daily`);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "all",
      guilds: null,
      actors: null,
      events: 2,
    });
  });

  async function seedRelays(at: string, guilds: bigint[]) {
    await db.insert(events).values(
      guilds.map((guildId) => ({
        occurredAt: new Date(at),
        name: "update.relayed",
        feature: "sushii-updates",
        guildId,
      })),
    );
  }

  test("relayed updates keep their row and leave the all row alone", async () => {
    await seed("2026-09-07T10:00:00Z", "social", [1, 2, 3, 4, 5]);
    await seedRelays("2026-09-07T11:00:00Z", [
      201n,
      202n,
      203n,
      204n,
      205n,
      206n,
    ]);
    await rollup.run(new Date("2026-09-15T01:15:00Z"));

    const rows = await db.select().from(schema.productUsageWeeklyInAppPublic);
    expect(rows.find((row) => row.feature === "all")?.guilds).toBe(5);
    expect(rows.find((row) => row.feature === "sushii-updates")?.guilds).toBe(
      6,
    );
  });

  test("relayed updates don't count in the live totals or levels", async () => {
    const now = new Date().toISOString();
    await seed(now, "social", [1, 2, 3, 4, 5]);
    await seedRelays(now, [201n, 202n, 203n, 204n, 205n, 206n]);

    const daily = await db.execute<{ feature: string; guilds: number }>(
      sql`SELECT * FROM analytics.usage_daily WHERE feature = 'all'`,
    );
    expect(daily.rows[0].guilds).toBe(5);

    const levels = await db.execute<{ level: string; servers: number }>(
      sql`SELECT * FROM analytics.server_activity WHERE period = 'today'`,
    );
    expect(levels.rows).toEqual([
      expect.objectContaining({ level: "1-9", servers: 5 }),
    ]);
  });

  test("server levels split by volume and hide small levels", async () => {
    const now = new Date();
    await seed(now.toISOString(), "social", [1, 2, 3, 4, 5]);
    await db.insert(events).values(
      Array.from({ length: 12 }, () => ({
        occurredAt: now,
        name: "interaction.command",
        feature: "social",
        guildId: 900n,
      })),
    );

    const { rows } = await db.execute<{
      level: string;
      servers: number | null;
    }>(sql`
      SELECT level, servers FROM analytics.server_activity
      WHERE period = '30d' ORDER BY servers NULLS LAST
    `);
    expect(rows).toEqual([
      { level: "1-9", servers: 5 },
      { level: "10-99", servers: null },
    ]);
  });

  test("command usage counts by command and hides small ones", async () => {
    const now = new Date();
    const uses = (route: string, users: number[]) =>
      users.map((user) => ({
        occurredAt: now,
        name: "interaction.command",
        feature: "social",
        guildId: 100n + BigInt(user),
        actor: actorCode(KEY, String(user)),
        props: { route, status: "success" },
      }));
    await db
      .insert(events)
      .values([...uses("rank", [1, 2, 3, 4, 5]), ...uses("rep", [1, 2])]);

    const { rows } = await db.execute(
      sql`SELECT * FROM analytics.command_usage ORDER BY period`,
    );
    expect(rows).toEqual(
      ["30d", "today", "week"].map((period) => ({
        period,
        command: "rank",
        uses: 5,
        users: 5,
        servers: 5,
      })),
    );
  });

  test("the reader sees the views and not the raw table", async () => {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE sushii_mcp_reader`);
      for (const view of [
        "usage_weekly",
        "retention_weekly",
        "prompt_funnel_weekly",
        "update_reach",
        "proof_weekly",
        "usage_daily",
        "usage_current_week",
        "command_usage",
        "server_activity",
      ]) {
        await tx.execute(sql.raw(`SELECT * FROM analytics.${view}`));
      }
    });

    const result = await db.execute<{ allowed: boolean }>(sql`
      SELECT has_table_privilege(
        'sushii_mcp_reader', 'app_public.product_events', 'SELECT'
      ) AS allowed
    `);
    expect(result.rows[0].allowed).toBe(false);
  });
});
