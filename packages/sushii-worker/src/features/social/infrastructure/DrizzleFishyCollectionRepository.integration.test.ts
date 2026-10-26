import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as fs from "fs";
import * as path from "path";

import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { FishyResult, RepResult } from "../domain";
import { utcDayNumber } from "../domain";
import { DrizzleFishyCollectionRepository } from "./DrizzleFishyCollectionRepository";

const users = schema.usersInAppPublic;

describe("DrizzleFishyCollectionRepository active days", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleFishyCollectionRepository;
  let interactionId = 1000;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleFishyCollectionRepository(db, () => 10);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  async function getUser(id: string) {
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, BigInt(id)));
    return row;
  }

  async function fishy(invokerId: string, at: string): Promise<FishyResult> {
    interactionId++;
    const result = await repo.catchFishy(
      invokerId,
      "999",
      interactionId.toString(),
      new Date(at),
    );
    if (result instanceof Date) {
      throw new Error("Unexpected cooldown");
    }

    return result;
  }

  test("counts each UTC day once and keeps missed days in the window", async () => {
    const first = await fishy("101", "2026-10-01T00:30:00Z");
    expect(first.activity).toEqual({
      activeDays: 1,
      multiplier: 1 + 0.5 / 30,
    });

    const sameDay = await fishy("101", "2026-10-01T13:00:00Z");
    expect(sameDay.activity.activeDays).toBe(1);
    expect((await getUser("101")).fishyDaysTotal).toBe(1);

    await fishy("101", "2026-10-02T02:00:00Z");
    const afterGap = await fishy("101", "2026-10-05T02:00:00Z");

    expect(afterGap.activity.activeDays).toBe(3);
    expect(afterGap.baseAmount).toBe(10);
    expect(afterGap.caughtAmount).toBe(Math.round(10 * (1 + 1.5 / 30)));

    const user = await getUser("101");
    expect(user.fishyDaysTotal).toBe(3);
    expect(user.fishyDaysAnchor).toBe(
      utcDayNumber(new Date("2026-10-05T00:00:00Z")),
    );
    expect(user.fishyDaysMask).toBe(0b11001);
  });

  test("tracks rep days separately without a lifetime total", async () => {
    const result = (await repo.giveRep(
      "102",
      "999",
      new Date("2026-10-01T00:30:00Z"),
    )) as RepResult;

    expect(result.activity.activeDays).toBe(1);
    const user = await getUser("102");
    expect(user.repDaysMask).toBe(1);
    expect(user.fishyDaysTotal).toBe(0);
  });

  test("seed migration converts streaks into active days", async () => {
    const lastUsed = new Date("2026-10-20T23:00:00Z");
    await db
      .insert(users)
      .values([
        {
          id: 201n,
          lastFishies: lastUsed,
          fishyStreak: 5,
          lastRep: lastUsed,
          repStreak: 0,
        },
        { id: 202n, lastFishies: lastUsed, fishyStreak: 45 },
        { id: 203n },
      ]);

    const seed = fs.readFileSync(
      path.join(
        process.cwd(),
        "drizzle",
        "0068_seed-active-days-from-streaks.sql",
      ),
      "utf8",
    );
    for (const statement of seed.split("--> statement-breakpoint")) {
      await db.execute(sql.raw(statement));
    }

    const short = await getUser("201");
    expect(short.fishyDaysAnchor).toBe(utcDayNumber(lastUsed));
    expect(short.fishyDaysMask).toBe(0b11111);
    expect(short.fishyDaysTotal).toBe(5);
    expect(short.repDaysMask).toBe(1);

    const long = await getUser("202");
    expect(long.fishyDaysMask).toBe(2 ** 30 - 1);
    expect(long.fishyDaysTotal).toBe(45);

    const unused = await getUser("203");
    expect(unused.fishyDaysAnchor).toBeNull();
    expect(unused.fishyDaysMask).toBe(0);
  });
});
