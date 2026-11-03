import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Client } from "pg";
import { Wait } from "testcontainers";

import {
  modLogProofsInAppPublic,
  modLogsInAppPublic,
} from "@/infrastructure/database/schema";
import * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import type { NewCaseProof } from "../../domain/entities/CaseProof";
import { DrizzleCaseProofRepository } from "./DrizzleCaseProofRepository";

const GUILD_ID = "111111111111111111";
const OTHER_GUILD_ID = "333333333333333333";
const USER_ID = "222222222222222222";
const MOD_ID = "444444444444444444";
const BACKFILL_TAG = "0077_case_proof_backfill";

async function insertCase(
  db: NodePgDatabase<typeof schema>,
  guildId: string,
  caseId: string,
  overrides: Partial<typeof modLogsInAppPublic.$inferInsert> = {},
): Promise<void> {
  await db.insert(modLogsInAppPublic).values({
    guildId: BigInt(guildId),
    caseId: BigInt(caseId),
    action: "ban",
    actionTime: new Date("2026-11-01T12:00:00Z"),
    pending: false,
    userId: BigInt(USER_ID),
    userTag: "user",
    executorId: BigInt(MOD_ID),
    ...overrides,
  });
}

function proof(overrides: Partial<NewCaseProof> = {}): NewCaseProof {
  return {
    guildId: GUILD_ID,
    caseId: "1",
    authorId: MOD_ID,
    content: null,
    attachments: [],
    sourceMessageUrl: null,
    sourceAuthorId: null,
    sourceContent: null,
    hostMessageId: null,
    source: "button",
    ...overrides,
  };
}

describe("DrizzleCaseProofRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleCaseProofRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleCaseProofRepository(db);
  });

  beforeEach(async () => {
    await db.delete(modLogProofsInAppPublic);
    await db.delete(modLogsInAppPublic);
    await insertCase(db, GUILD_ID, "1");
    await insertCase(db, GUILD_ID, "2");
    await insertCase(db, GUILD_ID, "3");
    await insertCase(db, OTHER_GUILD_ID, "1");
  });

  afterAll(async () => {
    await testDb?.close();
  });

  describe("add", () => {
    test("inserts every row and maps ids to strings", async () => {
      const added = await repo.add([
        proof({
          caseId: "1",
          content: "spam in #general",
          attachments: ["https://cdn.discordapp.com/a.png"],
          sourceMessageUrl: "https://discord.com/channels/1/2/3",
          sourceAuthorId: USER_ID,
          sourceContent: "free nitro",
          hostMessageId: "999999999999999999",
          source: "context_menu",
        }),
        proof({ caseId: "2", authorId: null, content: "same" }),
      ]);

      expect(added).toHaveLength(2);
      expect(added[0]).toMatchObject({
        guildId: GUILD_ID,
        caseId: "1",
        authorId: MOD_ID,
        content: "spam in #general",
        attachments: ["https://cdn.discordapp.com/a.png"],
        sourceMessageUrl: "https://discord.com/channels/1/2/3",
        sourceAuthorId: USER_ID,
        sourceContent: "free nitro",
        hostMessageId: "999999999999999999",
        source: "context_menu",
      });
      expect(typeof added[0].id).toBe("string");
      expect(added[0].createdAt).toBeInstanceOf(Date);
      expect(added[1]).toMatchObject({
        caseId: "2",
        authorId: null,
        attachments: [],
        hostMessageId: null,
      });
    });

    test("inserts nothing when any row fails", async () => {
      await expect(
        repo.add([proof({ caseId: "1" }), proof({ caseId: "404" })]),
      ).rejects.toThrow();

      expect(await repo.listByCase(GUILD_ID, "1")).toEqual([]);
    });

    test("returns an empty list for no rows", async () => {
      expect(await repo.add([])).toEqual([]);
    });

    test("keeps an explicit createdAt", async () => {
      const createdAt = new Date("2025-01-02T03:04:05Z");
      const [added] = await repo.add([proof({ createdAt })]);

      expect(added.createdAt.toISOString()).toBe(createdAt.toISOString());
    });
  });

  describe("listByCase", () => {
    test("returns the case's proof oldest first, ties by insert order", async () => {
      await repo.add([
        proof({
          content: "second",
          createdAt: new Date("2026-11-02T00:00:00Z"),
        }),
      ]);
      await repo.add([
        proof({
          content: "first",
          createdAt: new Date("2026-11-01T00:00:00Z"),
        }),
      ]);
      await repo.add([
        proof({ content: "third a" }),
        proof({ content: "third b" }),
      ]);
      await repo.add([proof({ caseId: "2", content: "other case" })]);
      await repo.add([
        proof({ guildId: OTHER_GUILD_ID, content: "other guild" }),
      ]);

      const list = await repo.listByCase(GUILD_ID, "1");

      expect(list.map((p) => p.content)).toEqual([
        "first",
        "second",
        "third a",
        "third b",
      ]);
    });
  });

  describe("listByCases", () => {
    test("groups by case, oldest first, leaving out cases without proof", async () => {
      await repo.add([
        proof({
          caseId: "2",
          content: "b2",
          createdAt: new Date("2026-11-02"),
        }),
        proof({
          caseId: "1",
          content: "a1",
          createdAt: new Date("2026-11-01"),
        }),
        proof({
          caseId: "2",
          content: "b1",
          createdAt: new Date("2026-11-01"),
        }),
        proof({ guildId: OTHER_GUILD_ID, caseId: "1", content: "x" }),
      ]);

      const byCase = await repo.listByCases(GUILD_ID, ["1", "2", "3"]);

      expect([...byCase.keys()].sort()).toEqual(["1", "2"]);
      expect(byCase.get("1")?.map((p) => p.content)).toEqual(["a1"]);
      expect(byCase.get("2")?.map((p) => p.content)).toEqual(["b1", "b2"]);
      expect(byCase.has("3")).toBe(false);
    });

    test("returns an empty map for no case ids", async () => {
      expect((await repo.listByCases(GUILD_ID, [])).size).toBe(0);
    });
  });

  describe("countsByCases", () => {
    test("counts entries and files per case", async () => {
      await repo.add([
        proof({ caseId: "1", attachments: ["a", "b"] }),
        proof({ caseId: "1", content: "text only" }),
        proof({ caseId: "1", attachments: ["c"] }),
        proof({ caseId: "2", content: "text only" }),
        proof({ guildId: OTHER_GUILD_ID, caseId: "1", attachments: ["x"] }),
      ]);

      const counts = await repo.countsByCases(GUILD_ID, ["1", "2", "3"]);

      expect(counts.get("1")).toEqual({ entries: 3, files: 3 });
      expect(counts.get("2")).toEqual({ entries: 1, files: 0 });
      expect(counts.has("3")).toBe(false);
    });

    test("returns an empty map for no case ids", async () => {
      expect((await repo.countsByCases(GUILD_ID, [])).size).toBe(0);
    });
  });

  describe("updateHosting", () => {
    test("replaces attachments and host message id", async () => {
      const [added] = await repo.add([
        proof({ attachments: ["https://old/a.png"] }),
      ]);

      await repo.updateHosting(GUILD_ID, added.id, {
        attachments: ["https://new/a.png"],
        hostMessageId: "888888888888888888",
      });

      const [updated] = await repo.listByCase(GUILD_ID, "1");
      expect(updated.attachments).toEqual(["https://new/a.png"]);
      expect(updated.hostMessageId).toBe("888888888888888888");

      await repo.updateHosting(GUILD_ID, added.id, {
        attachments: [],
        hostMessageId: null,
      });
      const [cleared] = await repo.listByCase(GUILD_ID, "1");
      expect(cleared.attachments).toEqual([]);
      expect(cleared.hostMessageId).toBeNull();
    });

    test("doesn't touch another guild's row", async () => {
      const [added] = await repo.add([proof({ attachments: ["keep"] })]);

      await repo.updateHosting(OTHER_GUILD_ID, added.id, {
        attachments: [],
        hostMessageId: "1",
      });

      const [row] = await repo.listByCase(GUILD_ID, "1");
      expect(row.attachments).toEqual(["keep"]);
      expect(row.hostMessageId).toBeNull();
    });
  });

  describe("latestCreatedAt", () => {
    test("returns the newest created_at across the cases", async () => {
      await repo.add([
        proof({ caseId: "1", createdAt: new Date("2026-11-01T00:00:00Z") }),
        proof({ caseId: "2", createdAt: new Date("2026-11-03T00:00:00Z") }),
        proof({ caseId: "3", createdAt: new Date("2026-11-05T00:00:00Z") }),
        proof({
          guildId: OTHER_GUILD_ID,
          caseId: "1",
          createdAt: new Date("2026-12-01T00:00:00Z"),
        }),
      ]);

      const latest = await repo.latestCreatedAt(GUILD_ID, ["1", "2"]);

      expect(latest?.toISOString()).toBe("2026-11-03T00:00:00.000Z");
    });

    test("skips excluded sources", async () => {
      await repo.add([
        proof({
          source: "action",
          createdAt: new Date("2026-11-01T00:00:00Z"),
        }),
        proof({
          source: "button",
          createdAt: new Date("2026-11-02T00:00:00Z"),
        }),
        proof({
          source: "backfill",
          createdAt: new Date("2026-11-04T00:00:00Z"),
        }),
      ]);

      expect((await repo.latestCreatedAt(GUILD_ID, ["1"]))?.toISOString()).toBe(
        "2026-11-04T00:00:00.000Z",
      );
      expect(
        (
          await repo.latestCreatedAt(GUILD_ID, ["1"], {
            excludeSources: ["backfill"],
          })
        )?.toISOString(),
      ).toBe("2026-11-02T00:00:00.000Z");
      expect(
        await repo.latestCreatedAt(GUILD_ID, ["1"], {
          excludeSources: ["action", "button", "backfill"],
        }),
      ).toBeNull();
    });

    test("returns null without proof or case ids", async () => {
      expect(await repo.latestCreatedAt(GUILD_ID, ["1"])).toBeNull();
      expect(await repo.latestCreatedAt(GUILD_ID, [])).toBeNull();
    });
  });

  test("rejects an unknown source", async () => {
    await expect(
      repo.add([proof({ source: "magic" as never })]),
    ).rejects.toThrow();
  });

  test("deleting a case deletes its proof", async () => {
    await repo.add([proof({ caseId: "1" }), proof({ caseId: "2" })]);

    await db
      .delete(modLogsInAppPublic)
      .where(
        and(
          eq(modLogsInAppPublic.guildId, BigInt(GUILD_ID)),
          eq(modLogsInAppPublic.caseId, 1n),
        ),
      );

    expect(await repo.listByCase(GUILD_ID, "1")).toEqual([]);
    expect(await repo.listByCase(GUILD_ID, "2")).toHaveLength(1);
  });
});

describe("case proof backfill migration (Integration)", () => {
  let container: StartedPostgreSqlContainer;
  let client: Client;
  let db: NodePgDatabase<typeof schema>;
  let beforeBackfillDir: string;

  beforeAll(async () => {
    const migrationsDir = path.join(process.cwd(), "drizzle");
    beforeBackfillDir = fs.mkdtempSync(path.join(os.tmpdir(), "case-proof-"));
    fs.cpSync(migrationsDir, beforeBackfillDir, { recursive: true });

    const journalPath = path.join(beforeBackfillDir, "meta", "_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    const backfillIndex = journal.entries.findIndex(
      (entry) => entry.tag === BACKFILL_TAG,
    );
    expect(backfillIndex).toBeGreaterThan(-1);
    journal.entries = journal.entries.slice(0, backfillIndex);
    fs.writeFileSync(journalPath, JSON.stringify(journal));

    container = await new PostgreSqlContainer("postgres:17-bookworm")
      .withDatabase("sushii_test")
      .withUsername("test_user")
      .withPassword("test_pass")
      .withWaitStrategy(Wait.forHealthCheck())
      .start();
    client = new Client({ connectionString: container.getConnectionUri() });
    await client.connect();
    db = drizzle({ client, schema });

    await client.query(
      fs.readFileSync(path.join(migrationsDir, "init.sql"), "utf8"),
    );
    await migrate(db, { migrationsFolder: beforeBackfillDir });

    await insertCase(db, GUILD_ID, "1", {
      attachments: ["", "https://cdn.discordapp.com/a.png"],
      actionTime: new Date("2026-10-01T08:30:00Z"),
    });
    await insertCase(db, GUILD_ID, "2");
    await insertCase(db, GUILD_ID, "3", { attachments: ["", ""] });
    await insertCase(db, GUILD_ID, "4", {
      attachments: ["https://x/b.png", "", "https://x/c.txt"],
      executorId: null,
    });
    await insertCase(db, GUILD_ID, "5", { attachments: [] });

    await migrate(db, { migrationsFolder: migrationsDir });
  });

  afterAll(async () => {
    await client?.end();
    await container?.stop();
    if (beforeBackfillDir) {
      fs.rmSync(beforeBackfillDir, { recursive: true, force: true });
    }
  });

  test("copies non-empty attachments into one proof row per case", async () => {
    const repo = new DrizzleCaseProofRepository(db);
    const byCase = await repo.listByCases(GUILD_ID, ["1", "2", "3", "4", "5"]);

    expect([...byCase.keys()].sort()).toEqual(["1", "4"]);

    expect(byCase.get("1")).toEqual([
      expect.objectContaining({
        authorId: MOD_ID,
        attachments: ["https://cdn.discordapp.com/a.png"],
        content: null,
        sourceMessageUrl: null,
        hostMessageId: null,
        source: "backfill",
      }),
    ]);
    expect(byCase.get("1")?.[0].createdAt.toISOString()).toBe(
      "2026-10-01T08:30:00.000Z",
    );

    expect(byCase.get("4")).toEqual([
      expect.objectContaining({
        authorId: null,
        attachments: ["https://x/b.png", "https://x/c.txt"],
        source: "backfill",
      }),
    ]);
  });
});
