import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  test,
} from "bun:test";
import { AuditLogEvent } from "discord.js";

import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";
import { modLogsInAppPublic } from "@/infrastructure/database/schema";

import type {
  IntegrationTestServices} from "../helpers/integrationTestSetup";
import {
  cleanupIntegrationTest,
  setupIntegrationTest,
} from "../helpers/integrationTestSetup";

import { runModerationTest } from "./shared/moderationTestRunner";
import {
  createBanTestCase,
  createDmConfigVariations,
} from "./shared/testCaseFactories";

describe("Ban Command Integration", () => {
  let services: IntegrationTestServices;

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

  describe("Basic Operations", () => {
    test("basic successful ban with reason", async () => {
      const testCase = createBanTestCase("ban - basic successful ban with reason", {
        commandOptions: {
          reason: "Test ban reason",
        },
        expectations: {
          moderationCase: {
            shouldCreate: true,
            pending: true,
            actionType: ActionType.Ban,
            reason: "Test ban reason",
          },
          interaction: {
            deferReply: true,
            editReply: true,
            embedContains: ["banned"],
          },
        },
      });

      await runModerationTest(testCase, services);
    });

    test("ban with delete message days", async () => {
      const testCase = createBanTestCase("ban - with delete message days", {
        commandOptions: {
          reason: "Spam messages",
          days: 7,
        },
      });

      await runModerationTest(testCase, services);
    });
  });

  describe("DM Behavior", () => {
    describe("Guild Config Defaults", () => {
      const baseBanCase = createBanTestCase("base ban case", {
        commandOptions: { reason: "Test reason" },
      });

      const dmVariations = createDmConfigVariations(baseBanCase, "ban");

      test.each(dmVariations)("$name", async (testCase) => {
        await runModerationTest(testCase, services);
      });
    });

    describe("Edge Cases", () => {
      test("no DM when no reason provided", async () => {
        const testCase = createBanTestCase("ban - no DM when no reason provided", {
          setup: {
            guildConfig: {
              banDmEnabled: true,
            },
          },
          commandOptions: {
            dm_reason: "yes_dm", // Even with yes_dm, no DM if no reason
          },
          expectations: {
            discordApi: {
              ban: { called: true },
              dmSend: { called: false }, // No DM without reason
            },
          },
        });

        await runModerationTest(testCase, services);
      });

      test("no DM when target not in guild (even with yes_dm)", async () => {
        const testCase = createBanTestCase("ban - no DM when target not in guild (even with yes_dm)", {
          setup: {
            targetIsMember: false, // User exists but not in guild
          },
          commandOptions: {
            reason: "Test ban non-member",
            dm_reason: "yes_dm", // Even explicit yes_dm shouldn't work for non-members
          },
          expectations: {
            discordApi: {
              ban: { called: true },
              dmSend: { called: false }, // No DM for non-members
            },
          },
        });

        await runModerationTest(testCase, services);
      });
    });
  });

  describe("Validation & Errors", () => {
    test("user does not exist", async () => {
      const testCase = createBanTestCase("ban - user does not exist", {
        setup: {
          targetExists: false, // User doesn't exist in Discord
          targetIsMember: false,
        },
        commandOptions: {
          reason: "Test ban non-existent user",
        },
        expectations: {
          shouldSucceed: false, // Should fail when user doesn't exist
          discordApi: {
            ban: { called: false },
            dmSend: { called: false },
          },
          moderationCase: {
            shouldCreate: false,
            pending: false, // Not applicable when not created
            actionType: ActionType.Ban, // Not applicable when not created
          },
          interaction: {
            deferReply: true,
            editReply: true, // Error message
          },
        },
      });

      await runModerationTest(testCase, services);
    });
  });

  describe("Audit Log Integration", () => {
    test("completed by audit log", async () => {
      const testCase = createBanTestCase("ban - completed by audit log", {
        setup: {
          guildConfig: {
            modLogChannel: "100000000000023456",
          },
        },
        commandOptions: {
          reason: "Test audit log completion",
        },
        expectations: {
          moderationCase: {
            shouldCreate: true,
            pending: true, // Initially pending
            actionType: ActionType.Ban,
          },
          auditLog: {
            event: AuditLogEvent.MemberBanAdd,
            completesCase: true, // Should complete the pending case
          },
        },
      });

      await runModerationTest(testCase, services);
    });
  });
});