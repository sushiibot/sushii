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
import { reasonTemplatesInAppPublic } from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { reasonContentKey } from "../domain/ReasonExpander";
import type { CreateReasonTemplateInput } from "../domain/ReasonTemplateRepository";
import { DrizzleReasonTemplateRepository } from "./DrizzleReasonTemplateRepository";

const GUILD_ID = "111111111111111111";
const OTHER_GUILD_ID = "333333333333333333";
const USER_ID = "222222222222222222";

function input(
  overrides: Partial<CreateReasonTemplateInput> = {},
): CreateReasonTemplateInput {
  const content = overrides.content ?? "Spamming in chat.";
  return {
    guildId: GUILD_ID,
    shortcut: "spam",
    content,
    contentKey: reasonContentKey(content),
    createdBy: USER_ID,
    ...overrides,
  };
}

describe("DrizzleReasonTemplateRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleReasonTemplateRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleReasonTemplateRepository(db);
  });

  beforeEach(async () => {
    await db.delete(reasonTemplatesInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  test("create returns the stored template", async () => {
    const created = (await repo.create(input())).unwrap();

    expect(created).toMatchObject({
      guildId: GUILD_ID,
      shortcut: "spam",
      content: "Spamming in chat.",
      contentKey: reasonContentKey("Spamming in chat."),
      createdBy: USER_ID,
      useCount: 0,
      updatedAt: null,
      lastUsedAt: null,
    });
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(await repo.findById(GUILD_ID, created.id)).toEqual(created);
  });

  test("stores full-length reasons that would overflow a text index key", async () => {
    const ascii = "a".repeat(3000);
    const cjk = "規".repeat(1000);

    const asciiResult = await repo.create(
      input({ shortcut: null, content: ascii }),
    );
    const cjkResult = await repo.create(
      input({ shortcut: null, content: cjk }),
    );

    expect(asciiResult.unwrap().content).toBe(ascii);
    expect(cjkResult.unwrap().content).toBe(cjk);
    expect(
      (await repo.findByContentKey(GUILD_ID, reasonContentKey(cjk)))?.id,
    ).toBe(cjkResult.unwrap().id);
  });

  test("duplicate shortcut in a guild is shortcut_taken", async () => {
    await repo.create(input());

    const result = await repo.create(input({ content: "Other" }));

    expect(result.err).toBe(true);
    expect(result.val).toBe("shortcut_taken");
  });

  test("duplicate content key in a guild is duplicate", async () => {
    await repo.create(input());

    const result = await repo.create(input({ shortcut: "other" }));

    expect(result.val).toBe("duplicate");
  });

  test("templates without shortcut coexist", async () => {
    const a = await repo.create(input({ shortcut: null, content: "A" }));
    const b = await repo.create(input({ shortcut: null, content: "B" }));

    expect(a.ok && b.ok).toBe(true);
    expect(await repo.countByGuild(GUILD_ID)).toBe(2);
  });

  test("same shortcut and content in another guild is allowed", async () => {
    await repo.create(input());

    const result = await repo.create(input({ guildId: OTHER_GUILD_ID }));

    expect(result.ok).toBe(true);
  });

  test("unexpected errors throw", async () => {
    await expect(
      repo.create(input({ createdBy: "99999999999999999999" })),
    ).rejects.toThrow();
  });

  test("find by shortcut and content key", async () => {
    const created = (await repo.create(input())).unwrap();

    expect((await repo.findByShortcut(GUILD_ID, "spam"))?.id).toBe(created.id);
    expect(
      (
        await repo.findByContentKey(
          GUILD_ID,
          reasonContentKey("spamming in chat."),
        )
      )?.id,
    ).toBe(created.id);
    expect(await repo.findByShortcut(OTHER_GUILD_ID, "spam")).toBeNull();
  });

  test("findById scopes by guild and tolerates non-numeric ids", async () => {
    const created = (await repo.create(input())).unwrap();

    expect(await repo.findById(OTHER_GUILD_ID, created.id)).toBeNull();
    expect(await repo.findById(GUILD_ID, "abc")).toBeNull();
  });

  test("list orders by use count desc then id asc and pages", async () => {
    const a = (
      await repo.create(input({ shortcut: "a", content: "A" }))
    ).unwrap();
    const b = (
      await repo.create(input({ shortcut: "b", content: "B" }))
    ).unwrap();
    const c = (
      await repo.create(input({ shortcut: "c", content: "C" }))
    ).unwrap();
    await repo.create(input({ guildId: OTHER_GUILD_ID }));
    await repo.recordUse(GUILD_ID, c.id);

    const all = await repo.listAllByGuild(GUILD_ID);
    const page = await repo.listByGuild(GUILD_ID, { limit: 2, offset: 1 });

    expect(all.map((t) => t.id)).toEqual([c.id, a.id, b.id]);
    expect(page.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  test("update changes fields and sets updatedAt", async () => {
    const created = (await repo.create(input())).unwrap();

    const updated = (
      await repo.update(GUILD_ID, created.id, {
        shortcut: null,
        content: "New",
        contentKey: "new",
      })
    ).unwrap();

    expect(updated).toMatchObject({ shortcut: null, content: "New" });
    expect(updated.updatedAt).toBeInstanceOf(Date);
  });

  test("update maps conflicts and missing rows", async () => {
    const first = (await repo.create(input())).unwrap();
    const second = (
      await repo.create(input({ shortcut: "other", content: "Other" }))
    ).unwrap();

    const taken = await repo.update(GUILD_ID, second.id, {
      shortcut: "spam",
      content: "Other",
      contentKey: "other",
    });
    const duplicate = await repo.update(GUILD_ID, second.id, {
      shortcut: "other",
      content: first.content,
      contentKey: first.contentKey,
    });
    const missing = await repo.update(GUILD_ID, "999999", {
      shortcut: null,
      content: "x",
      contentKey: "x",
    });

    expect(taken.val).toBe("shortcut_taken");
    expect(duplicate.val).toBe("duplicate");
    expect(missing.val).toBe("not_found");
    expect(
      (
        await repo.update(GUILD_ID, "abc", {
          shortcut: null,
          content: "x",
          contentKey: "x",
        })
      ).val,
    ).toBe("not_found");
  });

  test("delete returns whether a row was removed", async () => {
    const created = (await repo.create(input())).unwrap();

    expect(await repo.delete(OTHER_GUILD_ID, created.id)).toBe(false);
    expect(await repo.delete(GUILD_ID, created.id)).toBe(true);
    expect(await repo.delete(GUILD_ID, created.id)).toBe(false);
  });

  test("recordUse increments use count and sets lastUsedAt", async () => {
    const created = (await repo.create(input())).unwrap();

    await repo.recordUse(GUILD_ID, created.id);
    await repo.recordUse(GUILD_ID, created.id);

    const found = await repo.findById(GUILD_ID, created.id);
    expect(found?.useCount).toBe(2);
    expect(found?.lastUsedAt).toBeInstanceOf(Date);
  });

  test("countStats counts distinct guilds and every row", async () => {
    expect(await repo.countStats()).toEqual({ guilds: 0, total: 0 });

    await repo.create(input());
    await repo.create(input({ shortcut: "ads", content: "Advertising." }));
    await repo.create(input({ guildId: OTHER_GUILD_ID }));

    expect(await repo.countStats()).toEqual({ guilds: 2, total: 3 });
  });
});
