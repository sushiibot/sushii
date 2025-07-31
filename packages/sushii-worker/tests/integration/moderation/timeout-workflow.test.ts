import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AuditLogEvent } from "discord.js";

import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

import {
  IntegrationTestServices,
  cleanupIntegrationTest,
  setupIntegrationTest,
} from "../helpers/integrationTestSetup";
import { createMockUser } from "../helpers/mockDiscordClient";
import { MOCK_USERS } from "../helpers/mockUsers";
import {
  createMockAuditLogEntry,
  createMockGuild,
  createMockTimeoutInteraction,
} from "../helpers/mockFactories";

describe("Timeout Workflow Integration", () => {
  let services: IntegrationTestServices;

  beforeAll(async () => {
    services = await setupIntegrationTest();
  });

  afterAll(async () => {
    await cleanupIntegrationTest(services);
  });

  test("should create pending case on timeout command and complete via audit log", async () => {
    const { moderationFeature, mockDiscord } = services;
    const guildId = "test-guild-123";

    // Use predefined mock users
    const executorData = MOCK_USERS.MODERATOR_1;
    const targetData = MOCK_USERS.MEMBER_1;
    const executor = createMockUser(executorData);
    const target = createMockUser(targetData);

    // Configure which users are available in the mock Discord client
    mockDiscord.addUser(executorData);
    mockDiscord.addUser(targetData);
    mockDiscord.addGuildMember(guildId, executor.id);
    mockDiscord.addGuildMember(guildId, target.id);

    // Create mock timeout interaction
    const { interaction } = createMockTimeoutInteraction({
      guildId,
      executor,
      target,
      duration: "1h",
      reason: "Spamming in chat",
    });

    // Execute timeout command through the command handler
    const timeoutCommand = moderationFeature.commands.find(
      (cmd) => cmd.command.name === "timeout",
    );
    expect(timeoutCommand).toBeDefined();

    if (timeoutCommand) {
      await timeoutCommand.handler(interaction);
    }

    // Verify Discord API was called
    expect(mockDiscord.spies.timeout).toHaveBeenCalledWith(
      expect.any(Number), // Duration in milliseconds
      expect.stringContaining("Spamming in chat"),
    );

    // Verify pending case was created
    const pendingCases =
      await moderationFeature.repositories.moderationCase.findByUserId(
        guildId,
        target.id,
      );
    expect(pendingCases.ok).toBe(true);
    if (pendingCases.ok) {
      expect(pendingCases.val.length).toBe(1);
      const pendingCase = pendingCases.val[0];
      expect(pendingCase.pending).toBe(true);
      expect(pendingCase.actionType).toBe(ActionType.Timeout);
      expect(pendingCase.userId).toBe(target.id);
      expect(pendingCase.userTag).toBe(target.tag);
      expect(pendingCase.executorId).toBe(executor.id);
      expect(pendingCase.reason?.value).toBe("Spamming in chat");

      // Simulate Discord audit log event
      const auditLogEntry = createMockAuditLogEntry({
        action: AuditLogEvent.MemberUpdate,
        targetId: target.id,
        executorId: executor.id,
        reason: "Spamming in chat",
        guildId,
        changes: [
          {
            key: "communication_disabled_until",
            old: null,
            new: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour from now
          },
        ],
      });

      const mockGuild = createMockGuild({ id: guildId });

      // Process audit log through the audit log service
      const auditResult =
        await moderationServices.services.auditLogProcessing.processAuditLogEntry(
          auditLogEntry,
          mockGuild,
        );

      expect(auditResult.ok).toBe(true);
      if (auditResult.ok && auditResult.val) {
        expect(auditResult.val.matched).toBe(true);
        expect(auditResult.val.caseId).toBe(pendingCase.caseId);
      }

      // Verify case was updated from pending to completed
      const completedCases =
        await moderationServices.repositories.moderationCase.findByUserId(
          guildId,
          target.id,
        );
      expect(completedCases.ok).toBe(true);
      if (completedCases.ok) {
        expect(completedCases.val.length).toBe(1);
        const completedCase = completedCases.val[0];
        expect(completedCase.pending).toBe(false);
        expect(completedCase.caseId).toBe(pendingCase.caseId);
        expect(completedCase.executorId).toBe(executor.id);
      }
    }
  });

  test("should handle timeout removal via audit log", async () => {
    const { moderationServices } = services;
    const guildId = "test-guild-123";

    // Create mock users
    const executor = createMockUser({
      id: "untimeout-mod-123",
      tag: "UntimeoutMod#0001",
    });
    const target = createMockUser({
      id: "untimeout-target-456",
      tag: "UntimeoutUser#0002",
    });

    // Simulate timeout removal via Discord
    const auditLogEntry = createMockAuditLogEntry({
      action: AuditLogEvent.MemberUpdate,
      targetId: target.id,
      executorId: executor.id,
      reason: "Appeal accepted",
      guildId,
      changes: [
        {
          key: "communication_disabled_until",
          old: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // Was timed out
          new: null, // Timeout removed
        },
      ],
    });

    const mockGuild = createMockGuild({ id: guildId });

    // Process audit log
    const auditResult =
      await moderationServices.services.auditLogProcessing.processAuditLogEntry(
        auditLogEntry,
        mockGuild,
      );

    expect(auditResult.ok).toBe(true);
    if (auditResult.ok && auditResult.val) {
      expect(auditResult.val.created).toBe(true); // New untimeout case created
    }

    // Verify untimeout case was created
    const cases =
      await moderationServices.repositories.moderationCase.findByUserId(
        guildId,
        target.id,
      );
    expect(cases.ok).toBe(true);
    if (cases.ok) {
      const untimeoutCase = cases.val.find(
        (c) => c.actionType === ActionType.Untimeout,
      );
      expect(untimeoutCase).toBeDefined();
      if (untimeoutCase) {
        expect(untimeoutCase.pending).toBe(false);
        expect(untimeoutCase.executorId).toBe(executor.id);
        expect(untimeoutCase.reason?.value).toBe("Appeal accepted");
      }
    }
  });

  test("should handle multiple timeout commands for same user", async () => {
    const { moderationServices, mockDiscord } = services;
    const guildId = "test-guild-123";

    // Create mock users
    const executor = createMockUser({
      id: "multi-timeout-mod",
      tag: "MultiMod#0001",
    });
    const target = createMockUser({
      id: "multi-timeout-target",
      tag: "MultiTarget#0002",
    });

    // First timeout - 30 minutes
    const firstInteraction = createMockTimeoutInteraction({
      guildId,
      executor,
      target,
      duration: "30m",
      reason: "First violation",
    });

    const timeoutCommand = moderationServices.handlers.commands.get("timeout");
    if (timeoutCommand) {
      await timeoutCommand.execute(firstInteraction);
    }

    // Second timeout - 2 hours
    const secondInteraction = createMockTimeoutInteraction({
      guildId,
      executor,
      target,
      duration: "2h",
      reason: "Second violation",
    });

    if (timeoutCommand) {
      await timeoutCommand.execute(secondInteraction);
    }

    // Verify both Discord API calls
    expect(mockDiscord.spies.timeout).toHaveBeenCalledTimes(2);

    // Verify two pending cases were created
    const cases =
      await moderationServices.repositories.moderationCase.findByUserId(
        guildId,
        target.id,
      );
    expect(cases.ok).toBe(true);
    if (cases.ok) {
      const timeoutCases = cases.val.filter(
        (c) => c.actionType === ActionType.Timeout,
      );
      expect(timeoutCases.length).toBe(2);
      expect(timeoutCases[0].reason?.value).toBe("First violation");
      expect(timeoutCases[1].reason?.value).toBe("Second violation");
      expect(timeoutCases.every((c) => c.pending)).toBe(true);
    }
  });
});
