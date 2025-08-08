import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Embed } from "discord.js";
import { PermissionFlagsBits } from "discord.js";

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
import { createMockSlashCommandInteraction } from "../helpers/mockFactories";
import { MOCK_USERS } from "../helpers/mockUsers";

describe("Reason Command Integration", () => {
  let services: IntegrationTestServices;
  const guildId = "123456789012345678";
  const modLogChannelId = "987654321098765432";

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

    // Setup guild config with mod log enabled
    const config = GuildConfig.createDefault(guildId).updateLogChannel(
      "mod",
      modLogChannelId,
    );
    await services.moderationFeature.services.guildConfigRepository.save(
      config,
    );
  });

  describe("Single Case Updates", () => {
    test("should update reason for single case without existing reason", async () => {
      // Setup users
      services.mockDiscord.addUser(MOCK_USERS.MODERATOR_1);
      services.mockDiscord.addUser(MOCK_USERS.MEMBER_1);
      services.mockDiscord.addGuildMember(guildId, MOCK_USERS.MODERATOR_1.id);

      // Create a moderation case first
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

      // Create interaction
      const executorUser = services.mockDiscord.client.users.cache.get(
        MOCK_USERS.MODERATOR_1.id,
      );
      if (!executorUser) {
        throw new Error("Executor user not found in cache");
      }
      const guild = services.mockDiscord.addGuild(guildId, "Test Guild");

      // Note: Mock client doesn't need actual text channel for this test

      const { interaction, spies } = createMockSlashCommandInteraction({
        commandName: "reason",
        guildId,
        user: executorUser,
        guild,
        options: {
          case: "1",
          reason: "Updated test reason",
        },
      });

      // Execute command
      const reasonCommand = services.moderationFeature.commands.find(
        (cmd) => cmd.command.name === "reason",
      );
      expect(reasonCommand).toBeDefined();

      if (!reasonCommand) {
        throw new Error("Reason command not found");
      }
      await reasonCommand.handler(interaction);

      // Assert command deferred
      expect(spies.deferReply).toHaveBeenCalledTimes(1);
      expect(spies.editReply).toHaveBeenCalledTimes(1);

      // Verify case was updated
      const updatedCasesResult =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "1",
        );
      if (updatedCasesResult.err) {
        throw updatedCasesResult.val;
      }
      if (!updatedCasesResult.val) {
        throw new Error("Updated case not found");
      }
      const updatedCase = updatedCasesResult.val;
      expect(updatedCase.reason?.value).toBe("Updated test reason");
    });

    test("should handle invalid case range", async () => {
      // Setup users
      services.mockDiscord.addUser(MOCK_USERS.MODERATOR_1);
      services.mockDiscord.addGuildMember(guildId, MOCK_USERS.MODERATOR_1.id);

      // Create interaction with invalid case range
      const executorUser = services.mockDiscord.client.users.cache.get(
        MOCK_USERS.MODERATOR_1.id,
      );
      if (!executorUser) {
        throw new Error("Executor user not found in cache");
      }

      const guild = services.mockDiscord.addGuild(guildId, "Test Guild");

      const { interaction, spies } = createMockSlashCommandInteraction({
        commandName: "reason",
        guildId,
        user: executorUser,
        guild,
        options: {
          case: "invalid-range",
          reason: "Test reason",
        },
      });

      // Execute command
      const reasonCommand = services.moderationFeature.commands.find(
        (cmd) => cmd.command.name === "reason",
      );
      expect(reasonCommand).toBeDefined();

      if (!reasonCommand) {
        throw new Error("Reason command not found");
      }
      await reasonCommand.handler(interaction);

      // Assert error response
      expect(spies.reply).toHaveBeenCalledTimes(1);
      const replyCall = spies.reply.mock.calls[0] as unknown as [
        { embeds?: unknown[] },
      ];
      expect(replyCall[0]?.embeds).toBeDefined();
    });
  });

  describe("Range Updates", () => {
    test("should update multiple cases in range", async () => {
      // Setup users
      services.mockDiscord.addUser(MOCK_USERS.MODERATOR_1);
      services.mockDiscord.addUser(MOCK_USERS.MEMBER_1);
      services.mockDiscord.addGuildMember(guildId, MOCK_USERS.MODERATOR_1.id);

      // Create multiple moderation cases
      for (let i = 1; i <= 3; i++) {
        const existingCase = ModerationCase.create(
          guildId,
          i.toString(),
          ActionType.Ban,
          MOCK_USERS.MEMBER_1.id,
          MOCK_USERS.MEMBER_1.tag,
          MOCK_USERS.MODERATOR_1.id,
          null,
        );

        await services.moderationFeature.services.moderationCaseRepository.save(
          existingCase,
        );
      }

      // Create interaction
      const executorUser = services.mockDiscord.client.users.cache.get(
        MOCK_USERS.MODERATOR_1.id,
      );
      if (!executorUser) {
        throw new Error("Executor user not found in cache");
      }
      const guild = services.mockDiscord.addGuild(guildId, "Test Guild");

      // Note: Mock client doesn't need actual text channel for this test

      const { interaction, spies } = createMockSlashCommandInteraction({
        commandName: "reason",
        guildId,
        user: executorUser,
        guild,
        options: {
          case: "1-3",
          reason: "Bulk update reason",
        },
      });

      // Execute command
      const reasonCommand = services.moderationFeature.commands.find(
        (cmd) => cmd.command.name === "reason",
      );
      expect(reasonCommand).toBeDefined();

      if (!reasonCommand) {
        throw new Error("Reason command not found");
      }
      await reasonCommand.handler(interaction);

      // Assert command deferred
      expect(spies.deferReply).toHaveBeenCalledTimes(1);
      expect(spies.editReply).toHaveBeenCalledTimes(1);

      // Verify all cases were updated
      for (let i = 1; i <= 3; i++) {
        const updatedCasesResult =
          await services.moderationFeature.services.moderationCaseRepository.findById(
            guildId,
            i.toString(),
          );
        if (updatedCasesResult.err) {
          throw updatedCasesResult.val;
        }
        if (!updatedCasesResult.val) {
          throw new Error(`Updated case ${i} not found`);
        }
        const updatedCase = updatedCasesResult.val;
        expect(updatedCase.reason?.value).toBe("Bulk update reason");
      }
    });

    test("should handle large range limit", async () => {
      // Setup users
      services.mockDiscord.addUser(MOCK_USERS.MODERATOR_1);
      services.mockDiscord.addGuildMember(guildId, MOCK_USERS.MODERATOR_1.id);

      // Create interaction with range over 25 cases
      const executorUser = services.mockDiscord.client.users.cache.get(
        MOCK_USERS.MODERATOR_1.id,
      );
      if (!executorUser) {
        throw new Error("Executor user not found in cache");
      }
      const guild = services.mockDiscord.addGuild(guildId, "Test Guild");

      const { interaction, spies } = createMockSlashCommandInteraction({
        commandName: "reason",
        guildId,
        user: executorUser,
        guild,
        options: {
          case: "1-30",
          reason: "Test reason",
        },
      });

      // Execute command
      const reasonCommand = services.moderationFeature.commands.find(
        (cmd) => cmd.command.name === "reason",
      );
      expect(reasonCommand).toBeDefined();

      if (!reasonCommand) {
        throw new Error("Reason command not found");
      }
      await reasonCommand.handler(interaction);

      // Assert error response for too many cases
      expect(spies.reply).toHaveBeenCalledTimes(1);
      const replyCall = spies.reply.mock.calls[0] as unknown as [
        { embeds?: unknown[] },
      ];
      expect(replyCall[0]?.embeds).toBeDefined();
      expect(replyCall[0]?.embeds?.[0]).toHaveProperty("data");
      expect(
        (replyCall[0]?.embeds?.[0] as unknown as Embed).data?.description,
      ).toContain("25 cases");
    });
  });

  describe("Confirmation Flow", () => {
    test("should process 'all' confirmation button", async () => {
      // Setup users
      services.mockDiscord.addUser(MOCK_USERS.MODERATOR_1);
      services.mockDiscord.addUser(MOCK_USERS.MEMBER_1);
      services.mockDiscord.addGuildMember(guildId, MOCK_USERS.MODERATOR_1.id);

      // Create a moderation case with existing reason
      const reasonResult = Reason.create("Original reason");
      if (reasonResult.err) {
        throw reasonResult.val;
      }

      const existingCase = ModerationCase.create(
        guildId,
        "1",
        ActionType.Ban,
        MOCK_USERS.MEMBER_1.id,
        MOCK_USERS.MEMBER_1.tag,
        MOCK_USERS.MODERATOR_1.id,
        reasonResult.val,
      );

      await services.moderationFeature.services.moderationCaseRepository.save(
        existingCase,
      );

      // Add mod log channel to guild
      services.mockDiscord.addGuild(guildId, "Test Guild");
      // Note: Mock client doesn't need actual text channel for this test

      // Execute directly via the service (simulating the button handler)
      const updateResult =
        await services.moderationFeature.services.reasonUpdateService.updateReasons(
          {
            guildId,
            executorId: MOCK_USERS.MODERATOR_1.id,
            caseRangeStr: "1",
            reason: "New reason",
            onlyEmpty: false,
          },
        );

      if (updateResult.err) {
        throw updateResult.val;
      }
      expect(updateResult.val.updatedCases.length).toBe(1);

      // Verify case was updated
      const updatedCasesResult =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "1",
        );
      if (updatedCasesResult.err) {
        throw updatedCasesResult.val;
      }
      if (!updatedCasesResult.val) {
        throw new Error("Updated case not found");
      }
      const updatedCase = updatedCasesResult.val;
      expect(updatedCase.reason?.value).toBe("New reason");
    });

    test("should process 'empty' confirmation button", async () => {
      // Setup users
      services.mockDiscord.addUser(MOCK_USERS.MODERATOR_1);
      services.mockDiscord.addUser(MOCK_USERS.MEMBER_1);
      services.mockDiscord.addGuildMember(guildId, MOCK_USERS.MODERATOR_1.id);

      // Create moderation cases - one with reason, one without
      const reasonResult = Reason.create("Original reason");
      if (reasonResult.err) {
        throw reasonResult.val;
      }

      const caseWithReason = ModerationCase.create(
        guildId,
        "1",
        ActionType.Ban,
        MOCK_USERS.MEMBER_1.id,
        MOCK_USERS.MEMBER_1.tag,
        MOCK_USERS.MODERATOR_1.id,
        reasonResult.val,
      );

      const caseWithoutReason = ModerationCase.create(
        guildId,
        "2",
        ActionType.Kick,
        MOCK_USERS.MEMBER_1.id,
        MOCK_USERS.MEMBER_1.tag,
        MOCK_USERS.MODERATOR_1.id,
        null,
      );

      await services.moderationFeature.services.moderationCaseRepository.save(
        caseWithReason,
      );
      await services.moderationFeature.services.moderationCaseRepository.save(
        caseWithoutReason,
      );

      // Add mod log channel to guild
      services.mockDiscord.addGuild(guildId, "Test Guild");
      // Note: Mock client doesn't need actual text channel for this test

      // Execute update with onlyEmpty=true
      const updateResult =
        await services.moderationFeature.services.reasonUpdateService.updateReasons(
          {
            guildId,
            executorId: MOCK_USERS.MODERATOR_1.id,
            caseRangeStr: "1-2",
            reason: "New reason",
            onlyEmpty: true,
          },
        );

      if (updateResult.err) {
        throw updateResult.val;
      }
      expect(updateResult.val.updatedCases.length).toBe(1);
      expect(updateResult.val.updatedCases[0]?.caseId).toBe("2");

      // Verify only the case without reason was updated
      const case1Result =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "1",
        );
      const case2Result =
        await services.moderationFeature.services.moderationCaseRepository.findById(
          guildId,
          "2",
        );

      if (case1Result.err) {
        throw case1Result.val;
      }
      if (case2Result.err) {
        throw case2Result.val;
      }

      expect(case1Result.val?.reason?.value).toBe("Original reason");
      expect(case2Result.val?.reason?.value).toBe("New reason");
    });
  });

  describe("Permissions", () => {
    test("should require BanMembers permission", async () => {
      const reasonCommand = services.moderationFeature.commands.find(
        (cmd) => cmd.command.name === "reason",
      );
      expect(reasonCommand).toBeDefined();
      if (!reasonCommand) {
        throw new Error("Reason command not found");
      }
      expect(reasonCommand.command.default_member_permissions).toBe(
        PermissionFlagsBits.BanMembers.toString(),
      );
    });
  });
});
