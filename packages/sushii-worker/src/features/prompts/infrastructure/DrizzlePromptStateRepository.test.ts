import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { PromptSubject } from "../domain/PromptState";
import { DrizzlePromptStateRepository } from "./DrizzlePromptStateRepository";

const USER: PromptSubject = { scope: "user", id: 100000000000000001n };
const OTHER_USER: PromptSubject = { scope: "user", id: 100000000000000002n };
const GUILD: PromptSubject = { scope: "guild", id: 200000000000000001n };

describe("DrizzlePromptStateRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzlePromptStateRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzlePromptStateRepository(db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(schema.userPromptStatesInAppPublic);
    await db.delete(schema.guildPromptStatesInAppPublic);
  });

  test("a one-shot claim succeeds once per subject", async () => {
    expect(await repo.claim(USER, "tip", null)).toEqual({ previous: null });
    expect(await repo.claim(USER, "tip", null)).toBe(false);
    expect(await repo.claim(OTHER_USER, "tip", null)).toEqual({
      previous: null,
    });
  });

  test("a repeating claim succeeds again only after the threshold", async () => {
    expect(await repo.claim(GUILD, "follow", new Date(0))).not.toBe(false);
    expect(await repo.claim(GUILD, "follow", new Date(0))).toBe(false);
    const future = new Date(Date.now() + 60_000);
    expect(await repo.claim(GUILD, "follow", future)).not.toBe(false);
  });

  test("release restores the previous value so the prompt can be shown again", async () => {
    const claim = await repo.claim(USER, "tip", null);
    expect(claim).toEqual({ previous: null });
    await repo.release(USER, "tip", null);
    expect(await repo.claim(USER, "tip", null)).toEqual({ previous: null });
  });

  test("lastShownToUser covers user prompts and guild prompts recorded for the user", async () => {
    expect(await repo.lastShownToUser(USER.id)).toBeNull();

    await repo.claim(USER, "tip", null);
    const at = new Date(Date.now() + 5_000);
    await repo.recordShownToUser(USER.id, "follow", at);

    expect((await repo.lastShownToUser(USER.id))?.getTime()).toBe(at.getTime());
    expect(await repo.lastShownToUser(OTHER_USER.id)).toBeNull();
  });

  test("snooze, dismiss and complete are stored per scope", async () => {
    const until = new Date("2030-01-01T00:00:00Z");
    await repo.recordSnoozed(GUILD, "follow", until);
    await repo.recordDismissed(USER, "tip");
    await repo.recordCompleted(GUILD, "other");

    expect((await repo.find(GUILD, "follow"))?.snoozeUntil?.getTime()).toBe(
      until.getTime(),
    );
    expect((await repo.find(USER, "tip"))?.dismissedAt).toBeInstanceOf(Date);
    expect((await repo.find(GUILD, "other"))?.completedAt).toBeInstanceOf(Date);
    expect(await repo.find(USER, "follow")).toBeNull();
  });
});
