import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type * as schema from "@/infrastructure/database/schema";
import {
  guildConfigsInAppPublic,
  sushiiUpdateDeliveriesInAppPublic,
  sushiiUpdateIntrosInAppPublic,
  sushiiUpdatePostsInAppPublic,
} from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { UpdatePost } from "../domain/UpdatePost";
import { DrizzleSushiiUpdatesRepository } from "./DrizzleSushiiUpdatesRepository";

const POST_ID = "900000000000000001";
const CHANNEL = "200000000000000001";
const GUILD_A = "100000000000000001";
const GUILD_B = "100000000000000002";
const DAY = 24 * 60 * 60 * 1000;

function post(overrides: Partial<UpdatePost> = {}): UpdatePost {
  return { messageId: POST_ID, createdAt: new Date(), ...overrides };
}

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
    await db.delete(sushiiUpdateDeliveriesInAppPublic);
    await db.delete(sushiiUpdatePostsInAppPublic);
    await db.delete(sushiiUpdateIntrosInAppPublic);
    await db.delete(guildConfigsInAppPublic);
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

  async function delivery(guildId: string) {
    const [row] = await db
      .select()
      .from(sushiiUpdateDeliveriesInAppPublic)
      .where(eq(sushiiUpdateDeliveriesInAppPublic.guildId, BigInt(guildId)));
    return row;
  }

  async function age(guildId: string, interval: string) {
    await db
      .update(sushiiUpdateDeliveriesInAppPublic)
      .set({ updatedAt: sql`now() - ${interval}::interval` })
      .where(eq(sushiiUpdateDeliveriesInAppPublic.guildId, BigInt(guildId)));
  }

  test("saving a post is idempotent on the message ID", async () => {
    expect(await repo.savePost(post())).toBe(true);
    expect(await repo.savePost(post())).toBe(false);
    expect(await repo.findPostsSince(new Date(Date.now() - DAY))).toHaveLength(
      1,
    );
  });

  test("findPostsSince skips older posts, oldest first", async () => {
    await repo.savePost(
      post({ messageId: "1", createdAt: new Date(Date.now() - 8 * DAY) }),
    );
    await repo.savePost(
      post({ messageId: "3", createdAt: new Date(Date.now() - 1000) }),
    );
    await repo.savePost(
      post({ messageId: "2", createdAt: new Date(Date.now() - DAY) }),
    );

    const posts = await repo.findPostsSince(new Date(Date.now() - 7 * DAY));
    expect(posts.map((p) => p.messageId)).toEqual(["2", "3"]);
  });

  test("deletePostsBefore removes old posts and their deliveries", async () => {
    await repo.savePost(
      post({ messageId: "1", createdAt: new Date(Date.now() - 31 * DAY) }),
    );
    await repo.savePost(post({ messageId: "2" }));
    await repo.claimDelivery("1", GUILD_A);

    expect(await repo.deletePostsBefore(new Date(Date.now() - 30 * DAY))).toBe(
      1,
    );
    expect(await delivery(GUILD_A)).toBeUndefined();
    expect(await repo.findPostsSince(new Date(0))).toHaveLength(1);
  });

  test("only one of two concurrent claims wins", async () => {
    await repo.savePost(post());

    const results = await Promise.all([
      repo.claimDelivery(POST_ID, GUILD_A),
      repo.claimDelivery(POST_ID, GUILD_A),
    ]);

    expect(results.map((r) => r.kind).sort()).toEqual(["claimed", "taken"]);
  });

  test("a retry row is retaken only after its backoff, with the next attempt number", async () => {
    await repo.savePost(post());
    await insertGuild(GUILD_A);
    const markRetry = async () => {
      await repo.completeDelivery(POST_ID, GUILD_A, {
        status: "retry",
        errorCode: "http_502",
      });
      expect(await repo.claimDelivery(POST_ID, GUILD_A)).toEqual({
        kind: "taken",
      });
      expect(await repo.findPendingTargets(POST_ID, [GUILD_A])).toEqual([]);
    };

    await repo.claimDelivery(POST_ID, GUILD_A);
    // Backoff after attempt n is 2^(n-1) minutes.
    for (const [attempt, almost, past] of [
      [1, "50 seconds", "70 seconds"],
      [2, "110 seconds", "130 seconds"],
      [3, "230 seconds", "250 seconds"],
      [4, "470 seconds", "490 seconds"],
    ] as const) {
      await markRetry();
      await age(GUILD_A, almost);
      expect((await repo.claimDelivery(POST_ID, GUILD_A)).kind).toBe("taken");
      await age(GUILD_A, past);
      expect(await repo.findPendingTargets(POST_ID, [GUILD_A])).toHaveLength(1);
      expect(await repo.claimDelivery(POST_ID, GUILD_A)).toEqual({
        kind: "claimed",
        attempt: attempt + 1,
      });
    }
  });

  test("claiming for a deleted post reports it", async () => {
    expect(await repo.claimDelivery(POST_ID, GUILD_A)).toEqual({
      kind: "post_deleted",
    });
  });

  test("releaseClaim lets the delivery be claimed fresh", async () => {
    await repo.savePost(post());
    await repo.claimDelivery(POST_ID, GUILD_A);

    await repo.releaseClaim(POST_ID, GUILD_A);

    expect(await repo.claimDelivery(POST_ID, GUILD_A)).toEqual({
      kind: "claimed",
      attempt: 1,
    });
  });

  test("pending targets need notifications and updates on, this cluster, and no delivery", async () => {
    await repo.savePost(post());
    await insertGuild(GUILD_A);
    await insertGuild(GUILD_B);
    await insertGuild("100000000000000003", {
      logSushiiNotificationsEnabled: false,
    });
    await insertGuild("100000000000000004", { logSushiiNotifications: null });
    await insertGuild("100000000000000005", { sushiiUpdatesEnabled: false });
    await insertGuild("100000000000000006");
    await repo.claimDelivery(POST_ID, "100000000000000006");
    await insertGuild("100000000000000007");
    await repo.claimDelivery(POST_ID, "100000000000000007");
    await repo.completeDelivery(POST_ID, "100000000000000007", {
      status: "retry",
    });
    await age("100000000000000007", "2 minutes");
    await insertGuild("100000000000000008");
    await repo.claimDelivery(POST_ID, "100000000000000008");
    await repo.completeDelivery(POST_ID, "100000000000000008", {
      status: "retry",
    });

    const clusterGuilds = [
      GUILD_A,
      "100000000000000003",
      "100000000000000004",
      "100000000000000005",
      "100000000000000006",
      "100000000000000007",
      "100000000000000008",
    ];
    const targets = await repo.findPendingTargets(POST_ID, clusterGuilds);
    expect(targets.map((t) => t.guildId).sort()).toEqual([
      GUILD_A,
      "100000000000000007",
    ]);
    expect(await repo.findPendingTargets(POST_ID, [])).toEqual([]);
  });

  test("the cluster filter is a single parameter", async () => {
    await repo.savePost(post());
    await insertGuild(GUILD_A);
    const many = Array.from(
      { length: 70_000 },
      (_, i) => `2${String(i).padStart(17, "0")}`,
    );

    const targets = await repo.findPendingTargets(POST_ID, [...many, GUILD_A]);
    expect(targets).toEqual([{ guildId: GUILD_A, channelId: CHANNEL }]);
  });

  test("completeDelivery records the outcome", async () => {
    await repo.savePost(post());
    await repo.claimDelivery(POST_ID, GUILD_A);

    await repo.completeDelivery(POST_ID, GUILD_A, {
      status: "sent",
      messageId: "700000000000000001",
    });

    expect(await delivery(GUILD_A)).toMatchObject({
      status: "sent",
      messageId: BigInt("700000000000000001"),
      errorCode: null,
    });
  });

  test("the intro is claimed once per guild and survives post cleanup", async () => {
    await repo.savePost(post({ createdAt: new Date(Date.now() - 31 * DAY) }));
    await repo.claimDelivery(POST_ID, GUILD_A);
    await repo.completeDelivery(POST_ID, GUILD_A, { status: "sent" });

    const first = await Promise.all([
      repo.claimIntro(GUILD_A),
      repo.claimIntro(GUILD_A),
    ]);
    expect(first.sort()).toEqual([false, true]);

    await repo.deletePostsBefore(new Date(Date.now() - 30 * DAY));

    expect(await repo.claimIntro(GUILD_A)).toBe(false);
    expect(await repo.claimIntro(GUILD_B)).toBe(true);
  });

  test("counts claims stuck between 10 minutes and 6 hours", async () => {
    await repo.savePost(post());
    await repo.claimDelivery(POST_ID, GUILD_A);
    await repo.claimDelivery(POST_ID, GUILD_B);
    await repo.claimDelivery(POST_ID, "100000000000000003");
    await age(GUILD_A, "1 hour");
    await age("100000000000000003", "7 hours");

    const now = Date.now();
    expect(
      await repo.countStuckClaims(
        new Date(now - 6 * 60 * 60 * 1000),
        new Date(now - 10 * 60 * 1000),
      ),
    ).toBe(1);
  });
});
