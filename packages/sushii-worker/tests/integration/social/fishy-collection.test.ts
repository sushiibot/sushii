import { afterAll, beforeAll, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleFishyCollectionRepository } from "@/features/social/infrastructure/DrizzleFishyCollectionRepository";
import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

const fixture = new PostgresTestDatabase();
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repository: DrizzleFishyCollectionRepository;
const now = new Date("2026-10-25T12:00:00Z");
beforeAll(async () => {
  await fixture.initialize();
  pool = new Pool({ connectionString: fixture.getConnectionString(), max: 10 });
  db = drizzle({ client: pool, schema });
  repository = new DrizzleFishyCollectionRepository(db, () => 10);
}, 60000);
afterAll(async () => {
  await pool?.end();
  await fixture.close();
});

test("simultaneous catches award once; interaction replay returns the committed reveal", async () => {
  const responses = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      repository.catchFishy("100", "200", String(1000 + i), now),
    ),
  );
  expect(responses.filter((r) => !(r instanceof Date))).toHaveLength(1);
  const index = responses.findIndex((r) => !(r instanceof Date));
  const noReroll = new DrizzleFishyCollectionRepository(db, () => {
    throw Error("must not reroll");
  });
  expect(
    await noReroll.catchFishy(
      "100",
      "200",
      String(1000 + index),
      new Date(now.getTime() + 86400000),
    ),
  ).toEqual(responses[index]);
  expect(
    (await repository.getCollection("100")).reduce(
      (n, r) => n + r.catchCount,
      0,
    ),
  ).toBe(1);
  const [target] = await db
    .select()
    .from(schema.usersInAppPublic)
    .where(eq(schema.usersInAppPublic.id, 200n));
  expect(target.fishies).toBe(10n);
  expect(await repository.getCollection("200")).toEqual([]);
});

test("reciprocal first catches and rep cannot deadlock or overwrite balances", async () => {
  await Promise.all([
    repository.catchFishy("300", "400", "2000", now),
    repository.catchFishy("400", "300", "2001", now),
    repository.giveRep("300", "400", now),
    repository.giveRep("400", "300", now),
  ]);
  for (const id of [300n, 400n]) {
    const [user] = await db
      .select()
      .from(schema.usersInAppPublic)
      .where(eq(schema.usersInAppPublic.id, id));
    expect(user.fishies).toBe(10n);
    expect(user.rep).toBe(1n);
    expect(user.fishyStreak).toBe(1);
    expect(user.repStreak).toBe(1);
  }
});

test("self-fishing claims one cooldown, and failed transactions award nothing", async () => {
  const failing = new DrizzleFishyCollectionRepository(db, () => {
    throw Error("roll failure");
  });
  await expect(failing.catchFishy("500", "500", "3000", now)).rejects.toThrow(
    "roll failure",
  );
  expect(await repository.getCollection("500")).toEqual([]);
  const result = await repository.catchFishy("500", "500", "3000", now);
  expect(result instanceof Date).toBe(false);
  expect(
    await repository.catchFishy(
      "500",
      "500",
      "3001",
      new Date(now.getTime() + 12 * 3600000 - 1),
    ),
  ).toBeInstanceOf(Date);
  expect(
    await repository.catchFishy(
      "500",
      "500",
      "3002",
      new Date(now.getTime() + 12 * 3600000),
    ),
  ).not.toBeInstanceOf(Date);
});
