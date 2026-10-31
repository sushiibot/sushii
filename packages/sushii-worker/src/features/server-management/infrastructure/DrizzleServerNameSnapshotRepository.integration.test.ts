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
import { serverNameSnapshotsInAppPublic } from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { DrizzleServerNameSnapshotRepository } from "./DrizzleServerNameSnapshotRepository";

const GUILD_ID = "111111111111111111";
const OTHER_GUILD_ID = "333333333333333333";
const USER_ID = "222222222222222222";
const OTHER_USER_ID = "444444444444444444";

describe("DrizzleServerNameSnapshotRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleServerNameSnapshotRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleServerNameSnapshotRepository(db);
  });

  beforeEach(async () => {
    await db.delete(serverNameSnapshotsInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  test("returns null when nothing is saved", async () => {
    expect(await repo.findByGuild(GUILD_ID)).toBeNull();
  });

  test("saves and reads a snapshot", async () => {
    await repo.saveIfAbsent({
      guildId: GUILD_ID,
      name: "TWICE Fans",
      savedBy: USER_ID,
    });

    const snapshot = await repo.findByGuild(GUILD_ID);
    expect(snapshot).toMatchObject({
      guildId: GUILD_ID,
      name: "TWICE Fans",
      savedBy: USER_ID,
    });
    expect(snapshot?.savedAt).toBeInstanceOf(Date);
  });

  test("keeps the first snapshot when one already exists", async () => {
    await repo.saveIfAbsent({
      guildId: GUILD_ID,
      name: "TWICE Fans",
      savedBy: USER_ID,
    });
    await repo.saveIfAbsent({
      guildId: GUILD_ID,
      name: "TWICE Fans 🎂 Nayeon",
      savedBy: OTHER_USER_ID,
    });

    expect(await repo.findByGuild(GUILD_ID)).toMatchObject({
      name: "TWICE Fans",
      savedBy: USER_ID,
    });
  });

  test("deletes only the given guild's snapshot", async () => {
    await repo.saveIfAbsent({ guildId: GUILD_ID, name: "a", savedBy: USER_ID });
    await repo.saveIfAbsent({
      guildId: OTHER_GUILD_ID,
      name: "b",
      savedBy: USER_ID,
    });

    await repo.deleteByGuild(GUILD_ID);

    expect(await repo.findByGuild(GUILD_ID)).toBeNull();
    expect(await repo.findByGuild(OTHER_GUILD_ID)).not.toBeNull();
  });
});
