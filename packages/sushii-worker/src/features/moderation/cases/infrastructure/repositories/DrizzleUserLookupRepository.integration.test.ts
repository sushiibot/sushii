import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Logger } from "pino";
import { pino } from "pino";

import {
  guildBansInAppPublic,
  guildConfigsInAppPublic,
  modLogsInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { DrizzleUserLookupRepository } from "./DrizzleUserLookupRepository";

describe("DrizzleUserLookupRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleUserLookupRepository;
  let logger: Logger;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    logger = pino({ level: "silent" }); // Silent logger for tests
    repo = new DrizzleUserLookupRepository(db, logger);
  });

  beforeEach(async () => {
    // Clear tables before each test to ensure isolation
    await db.delete(modLogsInAppPublic);
    await db.delete(guildBansInAppPublic);
    await db.delete(guildConfigsInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  test("returns empty array when user has no bans", async () => {
    const userId = "123456789012345678";

    const result = await repo.getUserCrossServerBans(userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val).toHaveLength(0);
    }
  });

  test("returns bans from multiple guilds", async () => {
    const userId = "123456789012345678";
    const guild1 = "111111111111111111";
    const guild2 = "222222222222222222";
    const guild3 = "333333333333333333";

    // Insert bans in multiple guilds
    await db.insert(guildBansInAppPublic).values([
      { guildId: BigInt(guild1), userId: BigInt(userId) },
      { guildId: BigInt(guild2), userId: BigInt(userId) },
      { guildId: BigInt(guild3), userId: BigInt(userId) },
    ]);

    const result = await repo.getUserCrossServerBans(userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val).toHaveLength(3);
      
      const guildIds = result.val.map(ban => ban.guildId).sort();
      expect(guildIds).toEqual([guild1, guild2, guild3]);
      
      // All should have null reason/actionTime since no mod logs
      result.val.forEach(ban => {
        expect(ban.reason).toBe(null);
        expect(ban.actionTime).toBe(null);
        expect(ban.lookupDetailsOptIn).toBe(false);
      });
    }
  });

  test("joins mod log data correctly", async () => {
    const userId = "123456789012345678";
    const guild1 = "111111111111111111";
    const guild2 = "222222222222222222";
    const actionTime = new Date("2023-01-15T10:30:00Z");

    // Insert bans
    await db.insert(guildBansInAppPublic).values([
      { guildId: BigInt(guild1), userId: BigInt(userId) },
      { guildId: BigInt(guild2), userId: BigInt(userId) },
    ]);

    // Insert mod log entry for only one guild
    await db.insert(modLogsInAppPublic).values({
      guildId: BigInt(guild1),
      caseId: BigInt(1),
      action: "ban",
      actionTime,
      pending: false,
      userId: BigInt(userId),
      userTag: "TestUser#1234",
      executorId: BigInt("999999999999999999"),
      reason: "Spam violation",
      msgId: null,
      attachments: [],
      timeoutDuration: null,
      dmChannelId: null,
      dmMessageId: null,
      dmMessageError: null,
      dmIntended: false,
      dmIntentSource: "unknown",
      dmAttempted: false,
      dmNotAttemptedReason: null,
      dmFailureReason: null,
    });

    const result = await repo.getUserCrossServerBans(userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val).toHaveLength(2);
      
      const banWithModLog = result.val.find(ban => ban.guildId === guild1);
      const banWithoutModLog = result.val.find(ban => ban.guildId === guild2);
      
      // Ban with mod log should have reason and actionTime
      expect(banWithModLog?.reason).toBe("Spam violation");
      expect(banWithModLog?.actionTime).toEqual(actionTime);
      
      // Ban without mod log should have null values
      expect(banWithoutModLog?.reason).toBe(null);
      expect(banWithoutModLog?.actionTime).toBe(null);
    }
  });

  test("respects guild config opt-in settings", async () => {
    const userId = "123456789012345678";
    const guild1 = "111111111111111111"; // Will have opt-in enabled
    const guild2 = "222222222222222222"; // Will have opt-in disabled
    const guild3 = "333333333333333333"; // Will have no config (default false)

    // Insert bans
    await db.insert(guildBansInAppPublic).values([
      { guildId: BigInt(guild1), userId: BigInt(userId) },
      { guildId: BigInt(guild2), userId: BigInt(userId) },
      { guildId: BigInt(guild3), userId: BigInt(userId) },
    ]);

    // Insert guild configs
    await db.insert(guildConfigsInAppPublic).values([
      {
        id: BigInt(guild1),
        prefix: null,
        joinMsg: null,
        joinMsgEnabled: true,
        joinReact: null,
        leaveMsg: null,
        leaveMsgEnabled: true,
        msgChannel: null,
        logMsg: null,
        logMsgEnabled: true,
        logMod: null,
        logModEnabled: true,
        logMember: null,
        logMemberEnabled: true,
        timeoutDmText: null,
        timeoutCommandDmEnabled: true,
        timeoutNativeDmEnabled: true,
        warnDmText: null,
        banDmText: null,
        banDmEnabled: true,
        disabledChannels: [],
        lookupDetailsOptIn: true, // Opt-in enabled
        lookupPrompted: false,
      },
      {
        id: BigInt(guild2),
        prefix: null,
        joinMsg: null,
        joinMsgEnabled: true,
        joinReact: null,
        leaveMsg: null,
        leaveMsgEnabled: true,
        msgChannel: null,
        logMsg: null,
        logMsgEnabled: true,
        logMod: null,
        logModEnabled: true,
        logMember: null,
        logMemberEnabled: true,
        timeoutDmText: null,
        timeoutCommandDmEnabled: true,
        timeoutNativeDmEnabled: true,
        warnDmText: null,
        banDmText: null,
        banDmEnabled: true,
        disabledChannels: [],
        lookupDetailsOptIn: false, // Opt-in disabled
        lookupPrompted: false,
      },
    ]);

    const result = await repo.getUserCrossServerBans(userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.val).toHaveLength(3);
      
      const ban1 = result.val.find(ban => ban.guildId === guild1);
      const ban2 = result.val.find(ban => ban.guildId === guild2);
      const ban3 = result.val.find(ban => ban.guildId === guild3);
      
      expect(ban1?.lookupDetailsOptIn).toBe(true);
      expect(ban2?.lookupDetailsOptIn).toBe(false);
      expect(ban3?.lookupDetailsOptIn).toBe(false); // Default when no config
    }
  });

  test("handles query errors properly", async () => {
    // Test with invalid user ID format (non-numeric)
    const result = await repo.getUserCrossServerBans("invalid-user-id");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.val).toBe("Cross-server ban fetch failed");
    }
  });
});