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

import { DrizzleIpGrabberRepository } from "./DrizzleIpGrabberRepository";

const GUILD_ID = "100000000000000001";

describe("DrizzleIpGrabberRepository", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleIpGrabberRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleIpGrabberRepository(db);
  });

  afterAll(async () => {
    await testDb.close();
  });

  beforeEach(async () => {
    await db.delete(schema.ipGrabberDomainsInAppPublic);
    await db.delete(schema.ipGrabberGuildSettingsInAppPublic);
  });

  test("settings round-trip and only configured guilds are listed", async () => {
    const settings = {
      guildId: GUILD_ID,
      ruleId: "300000000000000101",
      ruleName: "Block links",
      providers: ["grabify" as const],
      managedKeywords: ["*grabify.link*"],
      lastSyncedAt: new Date("2026-11-02T12:00:00Z"),
      lastError: null,
    };
    await repo.saveSettings(settings);
    await repo.saveSettings({
      ...settings,
      guildId: "100000000000000002",
      ruleId: null,
      lastError: "rule_missing",
    });

    expect(await repo.getSettings(GUILD_ID)).toEqual(settings);
    expect((await repo.listConfiguredSettings()).map((s) => s.guildId)).toEqual(
      [GUILD_ID],
    );
    expect((await repo.getSettings("100000000000000002"))?.lastError).toBe(
      "rule_missing",
    );
  });

  test("addDomain inserts once and groups active hostnames by provider", async () => {
    expect(
      await repo.addDomain({
        hostname: "pics-share.click",
        provider: "grabify",
        source: "discovered",
        firstSeenGuildId: GUILD_ID,
        firstSeenGuildName: "KPOP Hub",
      }),
    ).toBe(true);
    expect(
      await repo.addDomain({
        hostname: "pics-share.click",
        provider: "grabify",
        source: "endpoint",
      }),
    ).toBe(false);

    const active = await repo.listActiveHostnames();
    expect(active.get("grabify")).toEqual(["pics-share.click"]);

    const domain = await repo.findDomain("pics-share.click");
    expect(domain?.source).toBe("discovered");
    expect(domain?.reviewStatus).toBe("pending");
  });

  test("failed checks go stale at the threshold and a new sighting reactivates", async () => {
    await repo.addDomain({
      hostname: "old.icu",
      provider: "grabify",
      source: "endpoint",
    });

    await repo.recordCheck("old.icu", false, 3);
    await repo.recordCheck("old.icu", false, 3);
    expect((await repo.findDomain("old.icu"))?.status).toBe("active");

    await repo.recordCheck("old.icu", true, 3);
    expect((await repo.findDomain("old.icu"))?.failedChecks).toBe(0);

    for (let i = 0; i < 3; i++) {
      await repo.recordCheck("old.icu", false, 3);
    }
    expect((await repo.findDomain("old.icu"))?.status).toBe("stale");
    expect((await repo.listActiveHostnames()).get("grabify")).toBeUndefined();

    expect(
      await repo.addDomain({
        hostname: "old.icu",
        provider: "grabify",
        source: "discovered",
      }),
    ).toBe(true);
    const reactivated = await repo.findDomain("old.icu");
    expect(reactivated?.status).toBe("active");
    expect(reactivated?.failedChecks).toBe(0);
  });

  test("revert only claims a posted review once and blocks re-adding", async () => {
    await repo.addDomain({
      hostname: "bad.click",
      provider: "grabify",
      source: "discovered",
    });

    expect(await repo.revert("bad.click")).toBe(false);
    expect((await repo.listPendingReviews()).map((d) => d.hostname)).toEqual([
      "bad.click",
    ]);

    await repo.markReviewPosted("bad.click", "400000000000000001");
    expect(await repo.listPendingReviews()).toEqual([]);

    expect(await repo.revert("bad.click")).toBe(true);
    expect(await repo.revert("bad.click")).toBe(false);
    expect(await repo.listRevertedHostnames()).toEqual(new Set(["bad.click"]));
    expect(
      await repo.addDomain({
        hostname: "bad.click",
        provider: "grabify",
        source: "discovered",
      }),
    ).toBe(false);
    expect((await repo.findDomain("bad.click"))?.status).toBe("reverted");
  });
});
