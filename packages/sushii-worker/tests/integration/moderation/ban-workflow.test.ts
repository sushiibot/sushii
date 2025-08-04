import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { AuditLogEvent } from "discord.js";

import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { modLogsInAppPublic } from "@/infrastructure/database/schema";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import {
  IntegrationTestServices,
  cleanupIntegrationTest,
  setupIntegrationTest,
} from "../helpers/integrationTestSetup";
import { createMockUser } from "../helpers/mockDiscordClient";
import {
  createMockAuditLogEntry,
  createMockBanInteraction,
  createMockGuild,
} from "../helpers/mockFactories";
import { MOCK_USERS } from "../helpers/mockUsers";

describe("Ban Workflow Integration", () => {
  let services: IntegrationTestServices;

  beforeAll(async () => {
    services = await setupIntegrationTest();
  });

  afterAll(async () => {
    await cleanupIntegrationTest(services);
  });

  beforeEach(async () => {
    // Clear table before each test
    await services.db.delete(modLogsInAppPublic).execute();
  });

  test("should create pending case on ban command and complete via audit log", async () => {
    // =========================================================================
    // Test constants, setup
    // =========================================================================
    const { moderationFeature, mockDiscord } = services;
    const guildId = "123456789012345678"; // Valid snowflake ID
    const modLogChannel = "100000000000023456";

    // Use predefined mock users
    const executorData = MOCK_USERS.MODERATOR_1;
    const targetData = MOCK_USERS.MEMBER_1;
    const executor = createMockUser(executorData);
    const target = createMockUser(targetData);
    const targetUserId = target.id;

    const banReason = "being a noob";

    // Configure which users are available in the mock Discord client
    mockDiscord.addUser(executorData);
    mockDiscord.addUser(targetData);
    mockDiscord.addGuildMember(guildId, executor.id);
    mockDiscord.addGuildMember(guildId, target.id);

    // Ensure mod log is set for audit-log handler
    const guildConfig = GuildConfig.createDefault(guildId).updateLogChannel(
      "mod",
      modLogChannel,
    );

    await moderationFeature.services.guildConfigRepository.save(guildConfig);

    // Get the guild from mockDiscord client instead of creating a new one
    const existingGuild = mockDiscord.client.guilds.cache.get(guildId);
    if (!existingGuild) {
      // Add the guild to the mock client if it doesn't exist
      mockDiscord.addGuild(guildId, "Test Guild");
    }

    // =========================================================================
    // Ban Interaction -- ARRANGE
    // =========================================================================

    // Create mock ban interaction
    const { interaction, spies: interactionSpies } = createMockBanInteraction({
      guildId,
      executor,
      users: targetUserId,
      reason: banReason,
      guild: mockDiscord.client.guilds.cache.get(guildId),
    });

    // Execute ban command through the command handler
    const banCommand = moderationFeature.commands.find(
      (cmd) => cmd.command.name === "ban",
    );
    expect(banCommand).toBeDefined();

    if (!banCommand) {
      throw new Error("Ban command not found in moderation commands");
    }

    // =========================================================================
    // Ban Interaction -- ACT
    // =========================================================================

    // resolves.not.toThrow() bug - https://github.com/oven-sh/bun/issues/9687
    // synchronous in bun tests even if the handler is async
    try {
      await banCommand.handler(interaction);
    } catch (err) {
      console.error("Ban command handler failed:", err);
      throw err;
    }

    // =========================================================================
    // Ban Interaction -- ASSERT
    // =========================================================================

    // Check response to interaction

    // Always a deferReply
    expect(interactionSpies.deferReply.mock.calls.length).toBe(1);

    // Always an editReply
    expect(interactionSpies.editReply.mock.calls.length).toBe(1);

    expect(interactionSpies.editReply.mock.calls.length).toBeGreaterThan(0);
    
    // Check that the edit reply was called with expected content
    const mockCalls = interactionSpies.editReply.mock.calls as unknown[];
    expect(mockCalls.length).toBeGreaterThan(0);
    
    const firstCall = mockCalls[0] as unknown[];
    expect(firstCall).toBeDefined();
    expect(firstCall.length).toBeGreaterThan(0);
    
    const replyPayload = firstCall[0] as Record<string, unknown>;
    expect(replyPayload).toBeDefined();
    expect(replyPayload.embeds).toBeDefined();
    
    const embeds = replyPayload.embeds as { toJSON(): { description: string } }[];
    expect(embeds[0]?.toJSON()?.description).toContain("banned");

    // Verify Discord.js ban was called
    expect(mockDiscord.spies.ban).toHaveBeenCalledWith(
      target.id,
      expect.objectContaining({
        reason: expect.stringContaining(banReason),
      }),
    );

    // Verify case was created (should be completed since Discord API succeeded)
    const userCasesResult =
      await moderationFeature.services.moderationCaseRepository.findByUserId(
        guildId,
        target.id,
      );

    if (userCasesResult.err) {
      throw new Error(
        `Failed to fetch completed cases: ${userCasesResult.val}`,
      );
    }

    expect(userCasesResult.ok).toBe(true);
    const userCases = userCasesResult.unwrap();

    console.log("Completed cases result:", userCases);

    expect(userCases.length).toBe(1);

    const newUserCase = userCases[0];

    expect(
      newUserCase.pending,
      "should be pending before audit-log handler",
    ).toBe(true);
    expect(newUserCase.actionType).toBe(ActionType.Ban);
    expect(newUserCase.userId).toBe(target.id);
    expect(newUserCase.userTag).toBe(target.tag);
    expect(newUserCase.executorId).toBe(executor.id);
    expect(newUserCase.reason?.value).toBe(banReason);

    // =========================================================================
    // Audit-Log Handler -- ARRANGE
    // =========================================================================

    // Simulate Discord audit log event
    const auditLogEntry = createMockAuditLogEntry({
      action: AuditLogEvent.MemberBanAdd,
      targetId: target.id,
      executorId: executor.id,
      reason: banReason,
      guildId,
    });

    const { guild: auditGuild } = createMockGuild({ id: guildId });

    // =========================================================================
    // Audit-Log Handler -- ACT
    // =========================================================================

    // Process audit log through the audit log service
    const auditResult =
      await moderationFeature.services.auditLogProcessingService.processAuditLogEntry(
        auditLogEntry,
        auditGuild,
      );

    // =========================================================================
    // Audit-Log Handler -- ASSERT
    // =========================================================================

    expect(auditResult.ok).toBe(true);
    if (auditResult.err) {
      throw new Error(`Audit log processing failed: ${auditResult.val}`);
    }

    if (auditResult.val === null) {
      throw new Error(
        "Audit log processing returned null, expected a valid result",
      );
    }

    // Started as pending case -> not pending
    expect(auditResult.val.wasPendingCase).toBe(true);
    expect(auditResult.val.modLogCase.caseId).toBe(newUserCase.caseId);

    // Verify case gets changed from pending to non-pending
    const finalCases =
      await moderationFeature.services.moderationCaseRepository.findByUserId(
        guildId,
        target.id,
      );

    expect(finalCases.ok).toBe(true);

    if (finalCases.err) {
      throw new Error(`Failed to fetch final cases: ${finalCases.val}`);
    }

    expect(finalCases.val.length).toBe(1);
    const finalCase = finalCases.val[0];

    expect(finalCase.pending).toBe(false);
    expect(finalCase.caseId).toBe(newUserCase.caseId);
    expect(finalCase.executorId).toBe(executor.id);
  });

  test("should handle ban without matching audit log", async () => {
    const { moderationFeature, mockDiscord } = services;
    const guildId = "123456789012345678";

    // Use predefined mock users
    const executorData = MOCK_USERS.MODERATOR_2;
    const targetData = MOCK_USERS.MEMBER_2;
    const executor = createMockUser(executorData);
    const target = createMockUser(targetData);

    // Configure available users
    mockDiscord.addUser(executorData);
    mockDiscord.addUser(targetData);
    mockDiscord.addGuildMember(guildId, executor.id);
    mockDiscord.addGuildMember(guildId, target.id);

    // Create mock ban interaction
    const { interaction } = createMockBanInteraction({
      guildId,
      executor,
      users: target.id,
      reason: "Test ban without audit log",
    });

    // Execute ban command
    const banCommand = moderationFeature.commands.find(
      (cmd) => cmd.command.name === "ban",
    );
    if (banCommand) {
      await banCommand.handler(interaction);
    }

    // Verify Discord API was called
    expect(mockDiscord.spies.ban).toHaveBeenCalledWith(
      target.id,
      expect.any(Object),
    );

    // Verify case was created and completed (since Discord API succeeded)
    const cases =
      await moderationFeature.services.moderationCaseRepository.findByUserId(
        guildId,
        target.id,
      );

    if (cases.err) {
      throw new Error(`Failed to fetch cases: ${cases.val}`);
    }

    expect(cases.val.length).toBe(1);
    const createdCase = cases.val[0];

    expect(createdCase.pending).toBe(true);
    expect(createdCase.actionType).toBe(ActionType.Ban);
  });

  test("should handle audit log for manual Discord ban", async () => {
    const { moderationFeature, mockDiscord } = services;
    const guildId = "123456789012345678";
    const modLogChannel = "100000000000023456";

    // Ensure mod log is set for audit-log handler
    const guildConfig = GuildConfig.createDefault(guildId).updateLogChannel(
      "mod",
      modLogChannel,
    );
    await moderationFeature.services.guildConfigRepository.save(guildConfig);

    // Use predefined mock users
    const executorData = MOCK_USERS.MODERATOR_3;
    const targetData = MOCK_USERS.MEMBER_3;
    const executor = createMockUser(executorData);
    const target = createMockUser(targetData);

    // Configure available users
    mockDiscord.addUser(executorData);
    mockDiscord.addUser(targetData);
    mockDiscord.addGuildMember(guildId, executor.id);
    mockDiscord.addGuildMember(guildId, target.id);

    const reason = "Manual ban via Discord";

    // Simulate manual ban via Discord (no bot command)
    const auditLogEntry = createMockAuditLogEntry({
      action: AuditLogEvent.MemberBanAdd,
      targetId: target.id,
      executorId: executor.id,
      reason,
      guildId,
    });

    const { guild: manualAuditGuild } = createMockGuild({ id: guildId });

    // Process audit log
    const auditResult =
      await moderationFeature.services.auditLogProcessingService.processAuditLogEntry(
        auditLogEntry,
        manualAuditGuild,
      );

    console.log("Manual audit result:", auditResult);
    if (!auditResult.ok) {
      console.error("Audit log processing failed:", auditResult.val);
    }
    expect(auditResult.ok).toBe(true);

    const auditLog = auditResult.unwrap();
    if (!auditLog) {
      throw new Error("Audit log processing returned null");
    }

    expect(auditLog.wasPendingCase).toBe(false); // No pending case to match
    expect(auditLog.modLogCase).toBeDefined(); // New case created

    // Verify case was created
    const cases =
      await moderationFeature.services.moderationCaseRepository.findByUserId(
        guildId,
        target.id,
      );

    if (cases.err) {
      throw new Error(`Failed to fetch cases: ${cases.val}`);
    }

    expect(cases.val.length).toBe(1);
    const createdCase = cases.val[0];

    // Not pending since created from audit log
    expect(createdCase.pending).toBe(false);
    expect(createdCase.actionType).toBe(ActionType.Ban);
    expect(createdCase.executorId).toBe(executor.id);
    expect(createdCase.reason?.value).toBe(reason);
  });
});
