import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Message } from "discord.js";

import {
  giveawayEntriesInAppPublic,
  giveawaysInAppPublic,
} from "@/infrastructure/database/schema";

import type {
  IntegrationTestServices} from "../helpers/integrationTestSetup";
import {
  cleanupIntegrationTest,
  setupIntegrationTest,
} from "../helpers/integrationTestSetup";
import {
  createBasicGiveawayData,
  createGiveawayDataWithLevelRequirement,
} from "./helpers/giveawayTestSetup";

describe("Giveaway Workflow Integration", () => {
  let services: IntegrationTestServices;

  beforeAll(async () => {
    services = await setupIntegrationTest();
  });

  afterAll(async () => {
    await cleanupIntegrationTest(services);
  });

  beforeEach(async () => {
    // Clear giveaway tables
    await services.db.delete(giveawayEntriesInAppPublic).execute();
    await services.db.delete(giveawaysInAppPublic).execute();

    services.mockDiscord.clearUsers();

    // Reset all spies
    Object.values(services.mockDiscord.spies).forEach((spy) => {
      if (typeof spy.mockClear === "function") {
        spy.mockClear();
      }
    });
  });

  test("happy path: create giveaway → user enters → draw winners", async () => {
    const { giveawayFeature, mockDiscord, db } = services;

    // ==========================================
    // ARRANGE: Setup test data and mock users
    // ==========================================
    const hostUser = {
      id: "100000000000000002",
      username: "host",
      discriminator: "0001",
      tag: "host#0001",
    };
    const participantUser = {
      id: "100000000000000003",
      username: "participant",
      discriminator: "0002",
      tag: "participant#0002",
    };
    const guildId = "100000000000000000";

    // Setup mock Discord environment
    mockDiscord.addUser(hostUser);
    mockDiscord.addUser(participantUser);
    mockDiscord.addGuildMember(guildId, hostUser.id);
    mockDiscord.addGuildMember(guildId, participantUser.id);
    mockDiscord.addGuild(guildId, "Test Guild");

    // Prepare giveaway data
    const giveawayData = createBasicGiveawayData({
      hostUserId: hostUser.id,
      guildId,
    });

    // ==========================================
    // ACT: Execute the complete workflow
    // ==========================================

    // Step 1: Create giveaway via service (simulating successful command)
    const createResult =
      await giveawayFeature.services.giveawayService.createGiveaway(
        giveawayData,
      );

    // Step 2: User enters giveaway
    const guild = mockDiscord.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error("Guild not found");
    }

    const member = await guild.members.fetch(participantUser.id);
    const entryResult =
      await giveawayFeature.services.giveawayEntryService.addEntry(
        giveawayData.id,
        member.id,
      );

    // Step 3: Draw winners (simulating task execution)
    const giveaway = await giveawayFeature.services.giveawayService.getGiveaway(
      guildId,
      giveawayData.id,
    );
    if (!giveaway.ok || !giveaway.val) {
      throw new Error("Failed to get giveaway");
    }

    const drawResult =
      await giveawayFeature.services.giveawayDrawService.drawWinners(
        giveaway.val,
        false,
        1,
      );

    // ==========================================
    // ASSERT: Verify expected outcomes
    // ==========================================

    // Verify giveaway creation
    expect(createResult.ok).toBe(true);
    const giveaways = await db.select().from(giveawaysInAppPublic).execute();
    expect(giveaways).toHaveLength(1);
    expect(giveaways[0].prize).toBe("Test Prize");

    // Verify user entry
    expect(guild).toBeDefined();
    expect(member).toBeDefined();
    expect(entryResult.ok).toBe(true);
    const entries = await db
      .select()
      .from(giveawayEntriesInAppPublic)
      .execute();
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe(BigInt(participantUser.id));

    // Verify winner drawing
    expect(giveaway.ok).toBe(true);
    expect(giveaway.val).toBeDefined();
    expect(drawResult.ok).toBe(true);
    if (drawResult.ok) {
      expect(drawResult.val.winnerIds).toHaveLength(1);
      expect(drawResult.val.winnerIds[0]).toBe(participantUser.id);
    }
  });

  test("entry validation: level requirement blocks ineligible user", async () => {
    const { giveawayFeature, mockDiscord } = services;

    // ==========================================
    // ARRANGE: Setup giveaway with level requirements
    // ==========================================
    const hostUser = {
      id: "100000000000000002",
      username: "host",
      discriminator: "0001",
      tag: "host#0001",
    };
    const lowLevelUser = {
      id: "100000000000000003",
      username: "lowlevel",
      discriminator: "0003",
      tag: "lowlevel#0003",
    };
    const guildId = "100000000000000000";

    // Setup mock Discord environment
    mockDiscord.addUser(hostUser);
    mockDiscord.addUser(lowLevelUser);
    mockDiscord.addGuildMember(guildId, hostUser.id);
    mockDiscord.addGuildMember(guildId, lowLevelUser.id);
    mockDiscord.addGuild(guildId, "Test Guild");

    // Create giveaway with level 10 requirement (user has default level 1)
    const giveawayData = createGiveawayDataWithLevelRequirement(10, {
      hostUserId: hostUser.id,
      guildId,
    });

    // ==========================================
    // ACT: Create giveaway and check eligibility
    // ==========================================
    const createResult =
      await giveawayFeature.services.giveawayService.createGiveaway(
        giveawayData,
      );

    const guild = mockDiscord.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error("Guild not found");
    }

    const member = await guild.members.fetch(lowLevelUser.id);
    const giveaway = await giveawayFeature.services.giveawayService.getGiveaway(
      guildId,
      giveawayData.id,
    );

    if (!giveaway.ok || !giveaway.val) {
      throw new Error("Failed to get giveaway");
    }

    const eligibilityResult =
      await giveawayFeature.services.giveawayEligibilityService.checkEligibility(
        giveaway.val,
        member,
      );

    // ==========================================
    // ASSERT: Verify user is blocked by level requirement
    // ==========================================
    expect(createResult.ok).toBe(true);
    expect(guild).toBeDefined();
    expect(member).toBeDefined();
    expect(giveaway.ok).toBe(true);
    expect(eligibilityResult.ok).toBe(true);

    if (eligibilityResult.ok) {
      expect(eligibilityResult.val.eligible).toBe(false);
      if (!eligibilityResult.val.eligible) {
        expect(eligibilityResult.val.reason).toContain("level");
      }
    }
  });

  test("winner drawing: should use giveaway's configured numWinners", async () => {
    const { giveawayFeature, mockDiscord, db } = services;

    // ==========================================
    // ARRANGE: Setup giveaway with multiple participants
    // ==========================================
    const hostUser = {
      id: "100000000000000002",
      username: "host",
      discriminator: "0001",
      tag: "host#0001",
    };
    const user1 = {
      id: "100000000000000003",
      username: "user1",
      discriminator: "0003",
      tag: "user1#0003",
    };
    const user2 = {
      id: "100000000000000004",
      username: "user2",
      discriminator: "0004",
      tag: "user2#0004",
    };
    const user3 = {
      id: "100000000000000005",
      username: "user3",
      discriminator: "0005",
      tag: "user3#0005",
    };
    const guildId = "100000000000000000";

    // Setup mock Discord environment with multiple users
    [hostUser, user1, user2, user3].forEach((user) => {
      mockDiscord.addUser(user);
      mockDiscord.addGuildMember(guildId, user.id);
    });
    mockDiscord.addGuild(guildId, "Test Guild");

    // Create giveaway with 2 winners (less than total participants)
    const giveawayData = createBasicGiveawayData({
      hostUserId: hostUser.id,
      guildId,
      numWinners: 2,
    });

    // ==========================================
    // ACT: Execute giveaway workflow with multiple entries
    // ==========================================
    await giveawayFeature.services.giveawayService.createGiveaway(giveawayData);

    // Add multiple user entries
    const guild = mockDiscord.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error("Guild not found");
    }

    for (const user of [user1, user2, user3]) {
      const member = await guild.members.fetch(user.id);
      await giveawayFeature.services.giveawayEntryService.addEntry(
        giveawayData.id,
        member.id,
      );
    }

    // Draw winners from the entry pool - should use giveaway's numWinners (2)
    const giveaway = await giveawayFeature.services.giveawayService.getGiveaway(
      guildId,
      giveawayData.id,
    );
    if (!giveaway.ok || !giveaway.val) {
      throw new Error("Failed to get giveaway");
    }

    // Should use giveaway.numWinners automatically (no winner count parameter needed)
    const drawResult =
      await giveawayFeature.services.giveawayDrawService.drawWinners(
        giveaway.val,
        false, // allowRepeatWinners
        // Winner count parameter omitted - should use giveaway.numWinners
      );

    // ==========================================
    // ASSERT: Verify winner selection logic
    // ==========================================

    // Verify all entries were recorded
    expect(guild).toBeDefined();
    const entries = await db
      .select()
      .from(giveawayEntriesInAppPublic)
      .execute();
    expect(entries).toHaveLength(3);

    // Verify giveaway and drawing process
    expect(giveaway.ok).toBe(true);
    expect(drawResult.ok).toBe(true);

    if (drawResult.ok) {
      // Should automatically use giveaway's configured numWinners (2)
      expect(drawResult.val.winnerIds).toHaveLength(giveaway.val.numWinners);
      expect(drawResult.val.winnerIds).toHaveLength(2);

      // Verify winners are unique (no duplicates)
      const uniqueWinners = new Set(drawResult.val.winnerIds);
      expect(uniqueWinners.size).toBe(2);

      // Verify winners are from participant pool (not random IDs)
      const participantIds = [user1.id, user2.id, user3.id];
      drawResult.val.winnerIds.forEach((winnerId: string) => {
        expect(participantIds).toContain(winnerId);
      });
    }
  });

  test("giveaway end state: should mark giveaway as ended after drawing winners", async () => {
    const { giveawayFeature, mockDiscord, db } = services;

    // ==========================================
    // ARRANGE: Setup basic giveaway and participant
    // ==========================================
    const hostUser = {
      id: "100000000000000002",
      username: "host",
      discriminator: "0001",
      tag: "host#0001",
    };
    const participantUser = {
      id: "100000000000000003",
      username: "participant",
      discriminator: "0002",
      tag: "participant#0002",
    };
    const guildId = "100000000000000000";

    mockDiscord.addUser(hostUser);
    mockDiscord.addUser(participantUser);
    mockDiscord.addGuildMember(guildId, hostUser.id);
    mockDiscord.addGuildMember(guildId, participantUser.id);
    mockDiscord.addGuild(guildId, "Test Guild");

    const giveawayData = createBasicGiveawayData({
      hostUserId: hostUser.id,
      guildId,
    });

    // ==========================================
    // ACT: Create giveaway, add entry, and draw winners
    // ==========================================
    await giveawayFeature.services.giveawayService.createGiveaway(giveawayData);

    const guild = mockDiscord.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error("Guild not found");
    }

    const member = await guild.members.fetch(participantUser.id);
    await giveawayFeature.services.giveawayEntryService.addEntry(
      giveawayData.id,
      member.id,
    );

    const giveaway = await giveawayFeature.services.giveawayService.getGiveaway(
      guildId,
      giveawayData.id,
    );
    if (!giveaway.ok || !giveaway.val) {
      throw new Error("Failed to get giveaway");
    }

    // Verify giveaway is not ended initially
    expect(giveaway.val.isEnded).toBe(false);

    // Draw winners - this should automatically mark the giveaway as ended
    const drawResult =
      await giveawayFeature.services.giveawayDrawService.drawWinners(
        giveaway.val,
        false,
      );

    // ==========================================
    // ASSERT: Verify giveaway is marked as ended
    // ==========================================
    expect(drawResult.ok).toBe(true);

    // BUG: Drawing winners should automatically mark giveaway as ended
    // Check the database directly
    const updatedGiveaways = await db.select().from(giveawaysInAppPublic).execute();
    expect(updatedGiveaways).toHaveLength(1);
    expect(updatedGiveaways[0].isEnded).toBe(true); // This should be true after drawing

    // Also verify through the service
    const updatedGiveaway = await giveawayFeature.services.giveawayService.getGiveaway(
      guildId,
      giveawayData.id,
    );
    if (updatedGiveaway.ok && updatedGiveaway.val) {
      expect(updatedGiveaway.val.isEnded).toBe(true);
    }
  });

  test("cache integration: button handler should sync with database entries", async () => {
    const { giveawayFeature, mockDiscord, db } = services;

    // ==========================================
    // ARRANGE: Setup giveaway and mock button interaction
    // ==========================================
    const hostUser = {
      id: "100000000000000002",
      username: "host", 
      discriminator: "0001",
      tag: "host#0001",
    };
    const participantUser = {
      id: "100000000000000003",
      username: "participant",
      discriminator: "0002",
      tag: "participant#0002",
    };
    const guildId = "100000000000000000";

    mockDiscord.addUser(hostUser);
    mockDiscord.addUser(participantUser);
    mockDiscord.addGuildMember(guildId, hostUser.id);
    mockDiscord.addGuildMember(guildId, participantUser.id);
    mockDiscord.addGuild(guildId, "Test Guild");

    const giveawayData = createBasicGiveawayData({
      hostUserId: hostUser.id,
      guildId,
    });

    await giveawayFeature.services.giveawayService.createGiveaway(giveawayData);

    // ==========================================
    // ACT: Add entry through cache service (simulating button handler)
    // ==========================================
    const guild = mockDiscord.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new Error("Guild not found");
    }

    const _member = await guild.members.fetch(participantUser.id);
    
    // BUG: Cache and database should be synchronized
    // First add to cache (like button handler does)
    const mockMessage = {
      id: giveawayData.id,
      channel: { id: giveawayData.channelId },
    } as Message<true>;
    
    await giveawayFeature.services.giveawayEntryCacheService.addEntryToCache(
      giveawayData.id,
      participantUser.id,
      mockMessage,
    );

    // ==========================================
    // ASSERT: Verify cache and database are in sync
    // ==========================================
    
    // Check cache shows user as entered
    const inCache = giveawayFeature.services.giveawayEntryCacheService.isInCache(
      giveawayData.id,
      participantUser.id,
    );
    expect(inCache).toBe(true);

    // Wait for cache to flush to database (cache flushes after 5 seconds of inactivity)
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Database should have the entry after cache flush
    const dbEntries = await db.select().from(giveawayEntriesInAppPublic).execute();
    expect(dbEntries).toHaveLength(1);
    expect(dbEntries[0].userId).toBe(BigInt(participantUser.id));

    // Verify entry service also sees the entry
    const hasEntry = await giveawayFeature.services.giveawayEntryService.hasUserEntered(
      giveawayData.id,
      participantUser.id,
    );
    expect(hasEntry.ok).toBe(true);
    expect(hasEntry.val).toBe(true);
  });
});
