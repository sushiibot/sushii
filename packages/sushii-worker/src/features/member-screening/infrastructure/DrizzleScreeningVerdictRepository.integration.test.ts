import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { NewScreeningVerdict } from "../domain/types";
import { DrizzleScreeningVerdictRepository } from "./DrizzleScreeningVerdictRepository";

const GUILD = "100000000000000001";
const OTHER_GUILD = "100000000000000002";
const USER = "200000000000000001";
const OTHER_USER = "200000000000000002";
const CHANNEL = "300000000000000001";
const LOG_CHANNEL = "300000000000000009";
const MOD = "400000000000000001";
const POST = "600000000000000001";
const OTHER_POST = "600000000000000002";
const NOW = new Date("2026-03-10T12:00:00Z");

let nextMessageId = 500000000000000000n;

function verdict(
  overrides: Partial<NewScreeningVerdict> = {},
): NewScreeningVerdict {
  nextMessageId += 1n;
  return {
    guildId: GUILD,
    channelId: CHANNEL,
    userId: USER,
    messageId: nextMessageId.toString(),
    kind: "text",
    createdAt: new Date(NOW.getTime() - 60_000),
    ...overrides,
  };
}

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

describe("DrizzleScreeningVerdictRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleScreeningVerdictRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleScreeningVerdictRepository(db, () => NOW);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(schema.screeningVerdictsInAppPublic);
  });

  async function posted(
    overrides: Partial<NewScreeningVerdict>,
    postMessageId: string,
  ) {
    const row = await repo.insert(verdict({ flagged: true, ...overrides }));
    await repo.setPost(row.id, LOG_CHANNEL, postMessageId);
    return row;
  }

  test("insert round-trips fields and drops judged on unflagged verdicts", async () => {
    const judged = { context: [], target: [{ author: "a", text: "buy now" }] };

    const flagged = await repo.insert(
      verdict({
        flagged: true,
        scores: { scam: 0.92 },
        topRule: "scam",
        judged,
        joinedAt: minutesAgo(30),
        ordinal: 2,
        cost: 0.0012,
      }),
    );
    const clean = await repo.insert(
      verdict({ flagged: false, scores: { scam: 0.1 }, judged }),
    );

    expect(flagged.judged).toEqual(judged);
    expect(flagged.scores).toEqual({ scam: 0.92 });
    expect(flagged.guildId).toBe(GUILD);
    expect(flagged.cost).toBeCloseTo(0.0012);
    expect(flagged.messageDeleted).toBe(false);
    expect(clean.judged).toBeNull();
    expect((await repo.findById(clean.id))?.judged).toBeNull();
    expect(await repo.findById(999999)).toBeNull();
  });

  test("scores are stored as a jsonb object", async () => {
    const inserted = await repo.insert(verdict({ scores: { scam: 0.5 } }));

    const result = await db.execute<{ type: string }>(
      sql`select jsonb_typeof(scores) as type from app_public.screening_verdicts where id = ${inserted.id}`,
    );

    expect(result.rows[0].type).toBe("object");
  });

  test("hasPfpVerdict dedupes across guilds", async () => {
    await repo.insert(
      verdict({ kind: "pfp", avatarHash: "abc", guildId: OTHER_GUILD }),
    );

    expect(await repo.hasPfpVerdict(USER, "abc")).toBe(true);
    expect(await repo.hasPfpVerdict(USER, "def")).toBe(false);
    expect(await repo.hasPfpVerdict(OTHER_USER, "abc")).toBe(false);
  });

  test("hasImageVerdict is scoped to the guild", async () => {
    await repo.insert(verdict({ kind: "image", imageKey: "key1" }));

    expect(await repo.hasImageVerdict(GUILD, "key1")).toBe(true);
    expect(await repo.hasImageVerdict(OTHER_GUILD, "key1")).toBe(false);
  });

  test("countChecksToday counts text, pfp and image since UTC midnight", async () => {
    await repo.insert(verdict({ kind: "text" }));
    await repo.insert(verdict({ kind: "pfp", avatarHash: "a" }));
    await repo.insert(verdict({ kind: "image", imageKey: "k" }));
    await repo.insert(verdict({ kind: "automod" }));
    await repo.insert(verdict({ kind: "miss" }));
    await repo.insert(verdict({ createdAt: new Date("2026-03-09T23:59:59Z") }));
    await repo.insert(verdict({ guildId: OTHER_GUILD }));

    expect(await repo.countChecksToday(GUILD)).toBe(3);

    await repo.insert(verdict({ createdAt: new Date("2026-03-10T00:00:00Z") }));
    expect(await repo.countChecksToday(GUILD)).toBe(4);
  });

  test("findOpenTextPost returns the latest open flagged text post since the cutoff", async () => {
    const older = await posted({ createdAt: minutesAgo(10) }, POST);
    const newer = await posted({ createdAt: minutesAgo(5) }, OTHER_POST);
    await repo.insert(verdict({ flagged: true, createdAt: minutesAgo(1) }));
    await posted({ createdAt: minutesAgo(120) }, "600000000000000003");

    const open = await repo.findOpenTextPost(GUILD, USER, minutesAgo(60));
    expect(open?.id).toBe(newer.id);
    expect(open?.postChannelId).toBe(LOG_CHANNEL);
    expect(open?.postMessageId).toBe(OTHER_POST);

    await repo.setIgnored(OTHER_POST, MOD, "too_minor", NOW);
    expect((await repo.findOpenTextPost(GUILD, USER, minutesAgo(60)))?.id).toBe(
      older.id,
    );
    expect(
      await repo.findOpenTextPost(OTHER_GUILD, USER, minutesAgo(60)),
    ).toBeNull();
  });

  test("findOpenTextPost ignores an unflagged text verdict with a post", async () => {
    await posted({ flagged: false }, POST);

    expect(await repo.findOpenTextPost(GUILD, USER, minutesAgo(60))).toBeNull();
  });

  test("latestForPost and postedForUser", async () => {
    const first = await posted({}, POST);
    const second = await posted({}, POST);
    await repo.insert(verdict({ flagged: true }));

    expect((await repo.latestForPost(POST))?.id).toBe(second.id);
    expect(await repo.latestForPost("600000000000000099")).toBeNull();
    expect(
      (await repo.postedForUser(GUILD, USER, minutesAgo(60))).map((v) => v.id),
    ).toEqual([first.id, second.id]);
  });

  test("hasFlagSince and findLatestCheckSince", async () => {
    await repo.insert(
      verdict({
        flagged: false,
        joinedAt: minutesAgo(600),
        createdAt: minutesAgo(30),
      }),
    );
    await repo.insert(
      verdict({
        kind: "pfp",
        flagged: false,
        joinedAt: minutesAgo(500),
        createdAt: minutesAgo(5),
      }),
    );
    await repo.insert(verdict({ flagged: true, createdAt: minutesAgo(120) }));

    expect(await repo.hasFlagSince(GUILD, USER, minutesAgo(60))).toBe(false);
    expect(await repo.hasFlagSince(GUILD, USER, minutesAgo(180))).toBe(true);
    expect(
      await repo.findLatestCheckSince(GUILD, USER, minutesAgo(60)),
    ).toEqual({ joinedAt: minutesAgo(500) });
    expect(
      await repo.findLatestCheckSince(GUILD, USER, minutesAgo(1)),
    ).toBeNull();
    expect(
      await repo.findLatestCheckSince(OTHER_GUILD, USER, minutesAgo(180)),
    ).toBeNull();
  });

  test("findLatestCheckSince ignores automod, miss and errored rows; hasMissSince finds misses", async () => {
    await repo.insert(verdict({ createdAt: minutesAgo(50) }));
    await repo.insert(verdict({ kind: "automod", createdAt: minutesAgo(5) }));
    await repo.insert(verdict({ kind: "miss", createdAt: minutesAgo(5) }));
    await repo.insert(
      verdict({
        error: "timeout",
        joinedAt: minutesAgo(10),
        createdAt: minutesAgo(5),
      }),
    );

    expect(
      await repo.findLatestCheckSince(GUILD, USER, minutesAgo(60)),
    ).toEqual({ joinedAt: null });
    expect(
      await repo.findLatestCheckSince(GUILD, USER, minutesAgo(40)),
    ).toBeNull();
    expect(await repo.hasMissSince(GUILD, USER, minutesAgo(60))).toBe(true);
    expect(await repo.hasMissSince(GUILD, USER, minutesAgo(1))).toBe(false);
    expect(await repo.hasMissSince(OTHER_GUILD, USER, minutesAgo(60))).toBe(
      false,
    );
  });

  test("automodSummary counts blocks and collects distinct rules", async () => {
    await repo.insert(verdict({ kind: "automod", categories: ["No links"] }));
    await repo.insert(verdict({ kind: "automod", categories: ["No links"] }));
    await repo.insert(verdict({ kind: "automod", categories: ["Slurs"] }));
    await repo.insert(
      verdict({
        kind: "automod",
        categories: ["Old"],
        createdAt: minutesAgo(120),
      }),
    );
    await repo.insert(verdict({ kind: "text", categories: ["Ignored"] }));

    const summary = await repo.automodSummary(GUILD, USER, minutesAgo(60));
    expect(summary.count).toBe(3);
    expect(summary.rules.sort()).toEqual(["No links", "Slurs"]);
  });

  test("setIgnored only touches outcome-less rows on the post and returns them", async () => {
    const open = await posted({}, POST);
    const done = await posted(
      { outcome: "actioned", outcomeAction: "banned" },
      POST,
    );

    const changed = await repo.setIgnored(POST, MOD, "allowed_here", NOW);

    expect(changed.map((v) => v.id)).toEqual([open.id]);
    expect(changed[0].outcome).toBe("ignored");
    expect(changed[0].outcomeBy).toBe(MOD);
    expect(changed[0].ignoreReason).toBe("allowed_here");
    expect(changed[0].outcomeAt).toEqual(NOW);
    expect((await repo.findById(done.id))?.outcome).toBe("actioned");
    expect(await repo.setIgnored(POST, MOD, "too_minor", NOW)).toEqual([]);
  });

  test("setActioned overrides open and ignored flagged rows since the cutoff", async () => {
    const open = await repo.insert(verdict({ flagged: true }));
    const ignored = await posted({}, POST);
    await repo.setIgnored(POST, MOD, "too_minor", NOW);
    const actioned = await repo.insert(
      verdict({ flagged: true, outcome: "actioned", outcomeAction: "kicked" }),
    );
    await repo.insert(verdict({ flagged: false }));
    await repo.insert(verdict({ flagged: true, createdAt: minutesAgo(120) }));
    await repo.insert(verdict({ flagged: true, userId: OTHER_USER }));

    const changed = await repo.setActioned(
      GUILD,
      USER,
      minutesAgo(60),
      null,
      "banned",
      NOW,
    );

    expect(changed.map((v) => v.id).sort()).toEqual(
      [open.id, ignored.id].sort(),
    );
    for (const row of changed) {
      expect(row.outcome).toBe("actioned");
      expect(row.outcomeAction).toBe("banned");
      expect(row.outcomeBy).toBeNull();
    }
    expect(changed.find((v) => v.id === ignored.id)?.ignoreReason).toBe(
      "too_minor",
    );
    expect((await repo.findById(actioned.id))?.outcomeAction).toBe("kicked");
  });

  test("updateOutcomeAction only changes actioned rows on the post", async () => {
    const actioned = await posted({}, POST);
    await repo.setActioned(GUILD, USER, minutesAgo(60), MOD, "banned", NOW);
    const open = await posted({}, POST);

    const changed = await repo.updateOutcomeAction(POST, "unbanned", MOD, NOW);

    expect(changed.map((v) => v.id)).toEqual([actioned.id]);
    expect(changed[0].outcomeAction).toBe("unbanned");
    expect((await repo.findById(open.id))?.outcomeAction).toBeNull();
  });

  test("markMessageDeleted marks flagged rows and returns the posted ones", async () => {
    const withPost = await posted({}, POST);
    const unposted = await repo.insert(verdict({ flagged: true }));
    const clean = await repo.insert(verdict({ flagged: false }));

    const changed = await repo.markMessageDeleted([
      withPost.messageId,
      unposted.messageId,
      clean.messageId,
    ]);

    expect(changed.map((v) => v.id)).toEqual([withPost.id]);
    expect(changed[0].messageDeleted).toBe(true);
    expect((await repo.findById(unposted.id))?.messageDeleted).toBe(true);
    expect((await repo.findById(clean.id))?.messageDeleted).toBe(false);
    expect(await repo.markMessageDeleted([])).toEqual([]);
  });

  test("statsSince groups by guild", async () => {
    await repo.insert(verdict({ kind: "text", cost: 0.01 }));
    await repo.insert(verdict({ kind: "pfp", avatarHash: "a", cost: 0.02 }));
    await posted({ kind: "image", imageKey: "k", outcome: "actioned" }, POST);
    await posted({ kind: "text" }, OTHER_POST);
    await repo.insert(verdict({ kind: "text", flagged: true }));
    await posted({ kind: "text", outcome: "ignored" }, "600000000000000003");
    await repo.insert(verdict({ kind: "automod", categories: ["x"] }));
    await repo.insert(verdict({ kind: "miss", categories: ["banned"] }));
    await repo.insert(
      verdict({ kind: "text", cost: 5, createdAt: minutesAgo(10_000) }),
    );
    await repo.insert(
      verdict({ guildId: OTHER_GUILD, kind: "text", cost: 0.5 }),
    );

    const stats = await repo.statsSince(minutesAgo(60));

    expect(stats).toHaveLength(2);
    expect(stats.find((s) => s.guildId === GUILD)).toEqual({
      guildId: GUILD,
      checks: 6,
      flagged: 4,
      actioned: 1,
      ignored: 1,
      awaiting: 1,
      missed: 1,
      cost: expect.closeTo(0.03, 6),
    });
    expect(stats.find((s) => s.guildId === OTHER_GUILD)?.cost).toBeCloseTo(0.5);
  });

  test("statsSince counts a burst on one post once and excludes automod and miss from checks", async () => {
    for (let i = 0; i < 3; i++) {
      await posted({ kind: "text" }, POST);
    }
    await repo.insert(verdict({ kind: "automod", categories: ["x"] }));
    await repo.insert(verdict({ kind: "miss", categories: ["banned"] }));

    let [stats] = await repo.statsSince(minutesAgo(60));
    expect(stats.checks).toBe(3);
    expect(stats.flagged).toBe(1);
    expect(stats.awaiting).toBe(1);
    expect(stats.missed).toBe(1);

    await repo.setIgnored(POST, MOD, "too_minor", NOW);
    [stats] = await repo.statsSince(minutesAgo(60));
    expect(stats.ignored).toBe(1);
    expect(stats.awaiting).toBe(0);

    await repo.setActioned(GUILD, USER, minutesAgo(60), MOD, "banned", NOW);
    [stats] = await repo.statsSince(minutesAgo(60));
    expect(stats.actioned).toBe(1);
    expect(stats.ignored).toBe(0);
  });

  test("statsSince counts unposted verdicts individually", async () => {
    await repo.insert(verdict({ flagged: true, outcome: "actioned" }));
    await repo.insert(verdict({ flagged: true, outcome: "actioned" }));
    await repo.insert(verdict({ flagged: true }));
    await posted({}, POST);
    await posted({}, POST);

    const [stats] = await repo.statsSince(minutesAgo(60));
    expect(stats.flagged).toBe(4);
    expect(stats.actioned).toBe(2);
    expect(stats.awaiting).toBe(1);
  });

  test("deleteOlderThan removes old verdicts and returns the count", async () => {
    await repo.insert(verdict({ createdAt: minutesAgo(10_000) }));
    await repo.insert(verdict({ createdAt: minutesAgo(9_000) }));
    const kept = await repo.insert(verdict({ createdAt: minutesAgo(1) }));

    expect(await repo.deleteOlderThan(minutesAgo(60))).toBe(2);
    expect((await repo.findById(kept.id))?.id).toBe(kept.id);
  });
});
