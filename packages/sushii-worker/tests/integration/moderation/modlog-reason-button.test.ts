import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import { ModerationCase } from "@/features/moderation/shared/domain/entities/ModerationCase";
import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { Reason } from "@/features/moderation/shared/domain/value-objects/Reason";
import { modLogsInAppPublic } from "@/infrastructure/database/schema";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";

import type { IntegrationTestServices } from "../helpers/integrationTestSetup";
import {
  cleanupIntegrationTest,
  setupIntegrationTest,
} from "../helpers/integrationTestSetup";
import { MOCK_USERS } from "../helpers/mockUsers";

describe("ModLog Reason Button Integration", () => {
  let services: IntegrationTestServices;
  const guildId = "123456789012345678";
  const modLogChannelId = "987654321098765432";

  // Helper function to setup guild config with mod log enabled
  const setupGuildConfig = async () => {
    const config = GuildConfig.createDefault(guildId).updateLogChannel(
      "mod",
      modLogChannelId,
    );
    await services.moderationFeature.services.guildConfigRepository.save(
      config,
    );
  };

  beforeAll(async () => {
    services = await setupIntegrationTest();
  });

  afterAll(async () => {
    await cleanupIntegrationTest(services);
  });

  beforeEach(async () => {
    // Clear mod logs and reset mock spies
    await services.db.delete(modLogsInAppPublic).execute();
    services.mockDiscord.clearUsers();

    // Reset all spies
    Object.values(services.mockDiscord.spies).forEach((spy) => {
      if (typeof spy.mockClear === "function") {
        spy.mockClear();
      }
    });
  });

  describe("Button Interaction Flow", () => {
    test("should update case reason via button interaction", async () => {
      // Setup guild config
      await setupGuildConfig();

      // Setup users
      services.mockDiscord.addUser(MOCK_USERS.MODERATOR_1);
      services.mockDiscord.addUser(MOCK_USERS.MEMBER_1);
      services.mockDiscord.addGuildMember(guildId, MOCK_USERS.MODERATOR_1.id);

      // Create a moderation case without reason
      const existingCase = ModerationCase.create(
        guildId,
        "1",
        ActionType.Ban,
        MOCK_USERS.MEMBER_1.id,
        MOCK_USERS.MEMBER_1.tag,
        MOCK_USERS.MODERATOR_1.id,
        null,
      );

      await services.moderationFeature.services.moderationCaseRepository.save(
        existingCase,
      );

      // Test the button handler logic by directly calling the service methods
      // First verify case exists
      const caseResult =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "1",
        );
      if (caseResult.err) {
        throw caseResult.val;
      }
      expect(caseResult.val).toBeDefined();

      if (!caseResult.val) {
        throw new Error("Case not found");
      }

      // Create a new reason
      const reasonResult = Reason.create("Button added reason");
      if (reasonResult.err) {
        throw reasonResult.val;
      }
      if (!reasonResult.val) {
        throw new Error("Failed to create reason");
      }

      // Update the case with the new reason (simulating what the button handler does)
      const updatedCase = caseResult.val.withReason(reasonResult.val);
      const updatedCaseWithExecutor = updatedCase.withExecutor(
        MOCK_USERS.MODERATOR_1.id,
      );

      // Save the updated case
      const updateResult =
        await services.moderationFeature.services.moderationCaseRepository.update(
          updatedCaseWithExecutor,
        );
      if (updateResult.err) {
        throw updateResult.val;
      }

      // Verify the case was updated
      const finalCaseResult =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "1",
        );
      if (finalCaseResult.err) {
        throw finalCaseResult.val;
      }
      if (!finalCaseResult.val) {
        throw new Error("Updated case not found");
      }

      const finalCase = finalCaseResult.val;
      expect(finalCase.reason?.value).toBe("Button added reason");
      expect(finalCase.executorId).toBe(MOCK_USERS.MODERATOR_1.id);
    });

    test("should handle updating case that already has reason", async () => {
      // Setup guild config
      await setupGuildConfig();

      // Setup users
      services.mockDiscord.addUser(MOCK_USERS.MODERATOR_1);
      services.mockDiscord.addUser(MOCK_USERS.MEMBER_1);
      services.mockDiscord.addGuildMember(guildId, MOCK_USERS.MODERATOR_1.id);

      // Create a moderation case with existing reason
      const originalReasonResult = Reason.create("Original reason");
      if (originalReasonResult.err) {
        throw originalReasonResult.val;
      }
      if (!originalReasonResult.val) {
        throw new Error("Failed to create original reason");
      }

      const existingCase = ModerationCase.create(
        guildId,
        "2",
        ActionType.Kick,
        MOCK_USERS.MEMBER_1.id,
        MOCK_USERS.MEMBER_1.tag,
        MOCK_USERS.MODERATOR_1.id,
        originalReasonResult.val,
      );

      await services.moderationFeature.services.moderationCaseRepository.save(
        existingCase,
      );

      // Get the case
      const caseResult =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "2",
        );
      if (caseResult.err) {
        throw caseResult.val;
      }
      if (!caseResult.val) {
        throw new Error("Case not found");
      }

      // Create a new reason to replace the old one
      const newReasonResult = Reason.create("Updated via button");
      if (newReasonResult.err) {
        throw newReasonResult.val;
      }
      if (!newReasonResult.val) {
        throw new Error("Failed to create new reason");
      }

      // Update the case with the new reason
      const updatedCase = caseResult.val.withReason(newReasonResult.val);
      const updatedCaseWithExecutor = updatedCase.withExecutor(
        MOCK_USERS.MODERATOR_1.id,
      );

      // Save the updated case
      const updateResult =
        await services.moderationFeature.services.moderationCaseRepository.update(
          updatedCaseWithExecutor,
        );
      if (updateResult.err) {
        throw updateResult.val;
      }

      // Verify the case was updated
      const finalCaseResult =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "2",
        );
      if (finalCaseResult.err) {
        throw finalCaseResult.val;
      }
      if (!finalCaseResult.val) {
        throw new Error("Updated case not found");
      }

      const finalCase = finalCaseResult.val;
      expect(finalCase.reason?.value).toBe("Updated via button");
      expect(finalCase.executorId).toBe(MOCK_USERS.MODERATOR_1.id);
    });

    test("should handle invalid reason validation", async () => {
      // Test reason validation with empty string
      const emptyReasonResult = Reason.create("");
      if (emptyReasonResult.err) {
        throw emptyReasonResult.val;
      }
      expect(emptyReasonResult.val).toBeNull();

      // Test reason validation with null
      const nullReasonResult = Reason.create(null);
      if (nullReasonResult.err) {
        throw nullReasonResult.val;
      }
      expect(nullReasonResult.val).toBeNull();

      // Test reason validation with too long string
      const longReason = "a".repeat(1025);
      const longReasonResult = Reason.create(longReason);
      expect(longReasonResult.err).toBe(true);
      if (longReasonResult.ok) {
        throw new Error("Expected error for long reason");
      }
      expect(longReasonResult.val).toContain("1024 characters");
    });

    test("should handle case not found scenario", async () => {
      // Try to find a case that doesn't exist (using valid numeric format)
      const caseResult =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "999999",
        );

      // This should return successfully but with null value (case not found)
      if (caseResult.err) {
        throw caseResult.val;
      }
      expect(caseResult.val).toBeNull();
    });
  });

  describe("Domain Logic", () => {
    test("should create moderation case with proper value objects", async () => {
      // Test creating a case with various action types and reasons
      const actionTypes = [
        ActionType.Ban,
        ActionType.Kick,
        ActionType.Warn,
        ActionType.Note,
      ];

      for (let i = 0; i < actionTypes.length; i++) {
        const actionType = actionTypes[i];
        const caseId = (i + 1).toString();

        const reasonResult = Reason.create(`Test reason for ${actionType}`);
        if (reasonResult.err) {
          throw reasonResult.val;
        }

        const moderationCase = ModerationCase.create(
          guildId,
          caseId,
          actionType,
          MOCK_USERS.MEMBER_1.id,
          MOCK_USERS.MEMBER_1.tag,
          MOCK_USERS.MODERATOR_1.id,
          reasonResult.val,
        );

        expect(moderationCase.caseId).toBe(caseId);
        expect(moderationCase.actionType).toBe(actionType);
        expect(moderationCase.userId).toBe(MOCK_USERS.MEMBER_1.id);
        expect(moderationCase.executorId).toBe(MOCK_USERS.MODERATOR_1.id);
        expect(moderationCase.reason?.value).toBe(
          `Test reason for ${actionType}`,
        );
      }
    });

    test("should correctly update executor when setting reason", async () => {
      // Create a case with one executor
      const originalCase = ModerationCase.create(
        guildId,
        "test",
        ActionType.Ban,
        MOCK_USERS.MEMBER_1.id,
        MOCK_USERS.MEMBER_1.tag,
        MOCK_USERS.MODERATOR_1.id,
        null,
      );

      expect(originalCase.executorId).toBe(MOCK_USERS.MODERATOR_1.id);

      // Update with a different executor (simulating a different moderator adding the reason)
      const reasonResult = Reason.create("Added by different mod");
      if (reasonResult.err) {
        throw reasonResult.val;
      }
      if (!reasonResult.val) {
        throw new Error("Failed to create reason");
      }

      const updatedCase = originalCase
        .withReason(reasonResult.val)
        .withExecutor(MOCK_USERS.MODERATOR_2.id);

      expect(updatedCase.executorId).toBe(MOCK_USERS.MODERATOR_2.id);
      expect(updatedCase.reason?.value).toBe("Added by different mod");

      // Original case should be unchanged
      expect(originalCase.executorId).toBe(MOCK_USERS.MODERATOR_1.id);
      expect(originalCase.reason).toBeNull();
    });
  });
});
