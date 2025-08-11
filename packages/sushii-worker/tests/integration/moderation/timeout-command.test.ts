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
  createTimeoutTestCase,
  createDmConfigVariations,
} from "./shared/testCaseFactories";

describe("Timeout Command Integration", () => {
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
    test("basic successful timeout with duration", async () => {
      const testCase = createTimeoutTestCase("timeout - basic successful timeout with duration", {
        commandOptions: {
          duration: "1h",
          reason: "Spamming in chat",
        },
        expectations: {
          moderationCase: {
            shouldCreate: true,
            pending: true,
            actionType: ActionType.Timeout,
            reason: "Spamming in chat",
          },
          interaction: {
            deferReply: true,
            editReply: true,
            embedContains: ["Timeout Successful"],
          },
        },
      });

      await runModerationTest(testCase, services);
    });
  });

  describe("DM Behavior", () => {
    describe("Guild Config Defaults", () => {
      const baseTimeoutCase = createTimeoutTestCase("base timeout case", {
        commandOptions: { 
          duration: "30m",
          reason: "Test reason",
        },
      });

      const dmVariations = createDmConfigVariations(baseTimeoutCase, "timeout");

      test.each(dmVariations)("$name", async (testCase) => {
        await runModerationTest(testCase, services);
      });
    });

    describe("Edge Cases", () => {
      test("no DM when no reason provided", async () => {
        const testCase = createTimeoutTestCase("timeout - no DM when no reason provided", {
          setup: {
            guildConfig: {
              timeoutCommandDmEnabled: true,
            },
          },
          commandOptions: {
            duration: "1h",
            dm_reason: "yes_dm", // Even with yes_dm, no DM if no reason
          },
          expectations: {
            discordApi: {
              timeout: { called: true },
              dmSend: { called: false }, // No DM without reason
            },
          },
        });

        await runModerationTest(testCase, services);
      });
    });
  });

  describe("Validation & Errors", () => {
    test("fails when no duration provided", async () => {
      const testCase = createTimeoutTestCase("timeout - fails when no duration provided", {
        commandOptions: {
          duration: undefined, // No duration provided
          reason: "Test timeout without duration",
        },
        expectations: {
          shouldSucceed: false, // Should fail validation
          errorMessage: "Duration is required",
          discordApi: {
            timeout: { called: false },
            dmSend: { called: false },
          },
          moderationCase: {
            shouldCreate: false,
            pending: false, // Not applicable when not created
            actionType: ActionType.Timeout, // Not applicable when not created
          },
          interaction: {
            deferReply: true,
            editReply: true, // Error message
          },
        },
      });

      await runModerationTest(testCase, services);
    });

    test("fails with invalid duration format", async () => {
      const testCase = createTimeoutTestCase("timeout - fails with invalid duration format", {
        commandOptions: {
          duration: "invalid-duration",
          reason: "Test invalid duration",
        },
        expectations: {
          shouldSucceed: false, // Should fail validation
          errorMessage: "Invalid duration",
          discordApi: {
            timeout: { called: false },
            dmSend: { called: false },
          },
          moderationCase: {
            shouldCreate: false,
            pending: false, // Not applicable when not created
            actionType: ActionType.Timeout, // Not applicable when not created
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
      const testCase = createTimeoutTestCase("timeout - completed by audit log", {
        setup: {
          guildConfig: {
            modLogChannel: "100000000000023456",
          },
        },
        commandOptions: {
          duration: "30m",
          reason: "Test audit log completion",
        },
        expectations: {
          moderationCase: {
            shouldCreate: true,
            pending: true, // Initially pending
            actionType: ActionType.Timeout,
          },
          auditLog: {
            event: AuditLogEvent.MemberUpdate, // Timeout shows as member update
            completesCase: true, // Should complete the pending case
          },
        },
      });

      await runModerationTest(testCase, services);
    });
  });
});