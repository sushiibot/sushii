import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  guildConfigsInAppPublic,
  guildPromptStatesInAppPublic,
} from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { DrizzleSushiiUpdatesRepository } from "./DrizzleSushiiUpdatesRepository";

const GUILD_A = "100000000000000001";
const GUILD_B = "100000000000000002";
const CHANNEL = "200000000000000001";
const WEBHOOK = "300000000000000001";

describe("DrizzleSushiiUpdatesRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleSushiiUpdatesRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleSushiiUpdatesRepository(db);
  });

  beforeEach(async () => {
    await db.delete(guildConfigsInAppPublic);
    await db.delete(guildPromptStatesInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  async function insertGuild(
    guildId: string,
    fields: Partial<typeof guildConfigsInAppPublic.$inferInsert> = {},
  ) {
    await db.insert(guildConfigsInAppPublic).values({
      id: BigInt(guildId),
      logSushiiNotifications: BigInt(CHANNEL),
      logSushiiNotificationsEnabled: true,
      ...fields,
    });
  }

  async function row(guildId: string) {
    const [r] = await db
      .select()
      .from(guildConfigsInAppPublic)
      .where(eq(guildConfigsInAppPublic.id, BigInt(guildId)));
    return r;
  }

  test("only one of two concurrent claims wins", async () => {
    await insertGuild(GUILD_A);

    const results = await Promise.all([
      repo.claimBackfill(GUILD_A),
      repo.claimBackfill(GUILD_A),
    ]);

    expect(results.filter((r) => r === CHANNEL)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect((await row(GUILD_A))?.sushiiUpdatesBackfilledAt).toBeInstanceOf(
      Date,
    );
  });

  test("candidates skip followed, decided, disabled and unset guilds", async () => {
    await insertGuild(GUILD_A);
    await insertGuild(GUILD_B, { sushiiUpdatesWebhookId: BigInt(WEBHOOK) });
    await insertGuild("100000000000000003", {
      sushiiUpdatesBackfilledAt: new Date(),
    });
    await insertGuild("100000000000000004", {
      logSushiiNotificationsEnabled: false,
    });
    await insertGuild("100000000000000005", { logSushiiNotifications: null });

    expect(await repo.findBackfillCandidates()).toEqual([
      { guildId: GUILD_A, channelId: CHANNEL },
    ]);
    expect(await repo.claimBackfill(GUILD_B)).toBeNull();
  });

  test("a recorded choice blocks the backfill", async () => {
    await insertGuild(GUILD_A);

    await repo.markDecided(GUILD_A);

    expect(await repo.claimBackfill(GUILD_A)).toBeNull();
    expect(await repo.findBackfillCandidates()).toEqual([]);
  });

  test("dismissing the follow_updates prompt opts the guild out of the backfill", async () => {
    await insertGuild(GUILD_A);
    await insertGuild(GUILD_B);
    await db.insert(guildPromptStatesInAppPublic).values([
      {
        guildId: BigInt(GUILD_A),
        promptId: "follow_updates",
        dismissedAt: new Date(),
      },
      {
        guildId: BigInt(GUILD_B),
        promptId: "follow_updates",
        snoozeUntil: new Date(Date.now() + 60_000),
      },
    ]);

    const candidates = await repo.findBackfillCandidates();
    expect(candidates.map((c) => c.guildId)).toEqual([GUILD_B]);
    expect(await repo.claimBackfill(GUILD_A)).toBeNull();
  });

  test("setWebhookId upserts and stamps the decision once", async () => {
    await repo.setWebhookId(GUILD_A, WEBHOOK);
    const created = await row(GUILD_A);
    expect(created?.sushiiUpdatesWebhookId).toBe(BigInt(WEBHOOK));
    const stamped = created?.sushiiUpdatesBackfilledAt;
    expect(stamped).toBeInstanceOf(Date);

    await repo.setWebhookId(GUILD_A, null);
    const cleared = await row(GUILD_A);
    expect(cleared?.sushiiUpdatesWebhookId).toBeNull();
    expect(cleared?.sushiiUpdatesBackfilledAt).toEqual(stamped as Date);
  });
});
