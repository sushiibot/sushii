import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import { serverNameHistoryInAppPublic } from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { DrizzleServerNameHistoryRepository } from "./DrizzleServerNameHistoryRepository";

const GUILD_ID = "111111111111111111";
const OTHER_GUILD_ID = "333333333333333333";

describe("DrizzleServerNameHistoryRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleServerNameHistoryRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleServerNameHistoryRepository(db);
  });

  beforeEach(async () => {
    await db.delete(serverNameHistoryInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  test("returns names most recently used first, excluding the current name", async () => {
    await repo.record(GUILD_ID, ["TWICE Fans"]);
    await repo.record(GUILD_ID, ["TWICE Fans 🎂 Nayeon"]);
    await repo.record(GUILD_ID, ["TWICE Fans 🎂 Jihyo"]);

    expect(await repo.search(GUILD_ID, "", "TWICE Fans 🎂 Jihyo", 25)).toEqual([
      "TWICE Fans 🎂 Nayeon",
      "TWICE Fans",
    ]);
  });

  test("re-recording a name moves it to the top without duplicating it", async () => {
    await repo.record(GUILD_ID, ["a"]);
    await repo.record(GUILD_ID, ["b"]);
    await repo.record(GUILD_ID, ["a", "a"]);

    expect(await repo.search(GUILD_ID, "", "", 25)).toEqual(["a", "b"]);
  });

  test("filters case-insensitively and treats LIKE wildcards literally", async () => {
    await repo.record(GUILD_ID, ["TWICE Fans", "100% ONCE", "Nayeon Day"]);

    expect(await repo.search(GUILD_ID, "nayeon", "", 25)).toEqual([
      "Nayeon Day",
    ]);
    expect(await repo.search(GUILD_ID, "%", "", 25)).toEqual(["100% ONCE"]);
  });

  test("scopes to the guild and respects the limit", async () => {
    await repo.record(GUILD_ID, ["a", "b", "c"]);
    await repo.record(OTHER_GUILD_ID, ["other"]);

    expect(await repo.search(GUILD_ID, "", "", 2)).toHaveLength(2);
    expect(await repo.search(GUILD_ID, "other", "", 25)).toEqual([]);
  });
});
