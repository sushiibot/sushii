import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/infrastructure/database/schema";
import { userNameHistoryInAppPublic } from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { DrizzleUserNameHistoryRepository } from "./DrizzleUserNameHistoryRepository";

const USER_ID = 1374380027327680654n;
const GUILD_ID = 1085724987505262712n;

describe("DrizzleUserNameHistoryRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleUserNameHistoryRepository;
  let pool: Pool;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleUserNameHistoryRepository(db);
    pool = new Pool({ connectionString: testDb.getConnectionString(), max: 5 });
  });

  beforeEach(async () => {
    await db.delete(userNameHistoryInAppPublic);
  });

  afterAll(async () => {
    await pool?.end();
    await testDb?.close();
  });

  test("inserts an entry for a snowflake-sized user ID", async () => {
    const inserted = await repo.insertIfChanged({
      userId: USER_ID,
      nameType: "nickname",
      guildId: GUILD_ID,
      value: "first",
    });

    expect(inserted).toBe(true);
    const rows = await repo.findByUserId(USER_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("first");
  });

  test("skips an entry when the value is unchanged", async () => {
    const entry = {
      userId: USER_ID,
      nameType: "nickname" as const,
      guildId: GUILD_ID,
      value: "same",
    };

    await repo.insertIfChanged(entry);
    const second = await repo.insertIfChanged(entry);

    expect(second).toBe(false);
    expect(await repo.findByUserId(USER_ID)).toHaveLength(1);
  });

  test("concurrent identical writes insert one row", async () => {
    const entry = {
      userId: USER_ID,
      nameType: "username" as const,
      guildId: null,
      value: "racer",
    };

    // Separate connections; the shared test client would run the transactions serially.
    const pooledRepo = new DrizzleUserNameHistoryRepository(
      drizzle({ client: pool, schema }),
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () => pooledRepo.insertIfChanged(entry)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await repo.findByUserId(USER_ID)).toHaveLength(1);
  });
});
