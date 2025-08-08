import { ActionType } from "@/features/moderation/shared/domain/value-objects/ActionType";

import { MOCK_USERS } from "../../helpers/mockUsers";
import type { ModerationTestCase } from "./testCaseTypes";

const DEFAULT_GUILD_ID = "123456789012345678";

interface BaseTestCaseOverrides {
  name?: string;
  setup?: Partial<ModerationTestCase["setup"]>;
  commandOptions?: Partial<ModerationTestCase["commandOptions"]>;
  expectations?: Partial<ModerationTestCase["expectations"]>;
}

/**
 * Creates a ban test case with sensible defaults
 */
export function createBanTestCase(
  name: string,
  overrides: BaseTestCaseOverrides = {},
): ModerationTestCase {
  return {
    name,
    actionType: ActionType.Ban,
    commandName: "ban",
    setup: {
      guildId: DEFAULT_GUILD_ID,
      executorUser: MOCK_USERS.MODERATOR_1,
      targetUser: MOCK_USERS.MEMBER_1,
      targetExists: true,
      targetIsMember: true,
      ...overrides.setup,
    },
    commandOptions: {
      users: overrides.setup?.targetUser?.id || MOCK_USERS.MEMBER_1.id,
      ...overrides.commandOptions,
    },
    expectations: {
      shouldSucceed: true,
      discordApi: {
        ban: { called: true },
        dmSend: { called: true }, // Default: guild config enables DMs
      },
      moderationCase: {
        shouldCreate: true,
        pending: true,
        actionType: ActionType.Ban,
      },
      interaction: {
        deferReply: true,
        editReply: true,
      },
      ...overrides.expectations,
    },
  };
}

/**
 * Creates a timeout test case with sensible defaults
 */
export function createTimeoutTestCase(
  name: string,
  overrides: BaseTestCaseOverrides = {},
): ModerationTestCase {
  return {
    name,
    actionType: ActionType.Timeout,
    commandName: "timeout",
    setup: {
      guildId: DEFAULT_GUILD_ID,
      executorUser: MOCK_USERS.MODERATOR_1,
      targetUser: MOCK_USERS.MEMBER_1,
      targetExists: true,
      targetIsMember: true,
      ...overrides.setup,
    },
    commandOptions: {
      users: overrides.setup?.targetUser?.id || MOCK_USERS.MEMBER_1.id,
      duration: "1h", // Default duration
      ...overrides.commandOptions,
    },
    expectations: {
      shouldSucceed: true,
      discordApi: {
        timeout: { called: true },
        dmSend: { called: true }, // Default: guild config enables DMs
      },
      moderationCase: {
        shouldCreate: true,
        pending: true,
        actionType: ActionType.Timeout,
      },
      interaction: {
        deferReply: true,
        editReply: true,
      },
      ...overrides.expectations,
    },
  };
}

/**
 * Creates a kick test case with sensible defaults
 */
export function createKickTestCase(
  name: string,
  overrides: BaseTestCaseOverrides = {},
): ModerationTestCase {
  return {
    name,
    actionType: ActionType.Kick,
    commandName: "kick",
    setup: {
      guildId: DEFAULT_GUILD_ID,
      executorUser: MOCK_USERS.MODERATOR_1,
      targetUser: MOCK_USERS.MEMBER_1,
      targetExists: true,
      targetIsMember: true,
      ...overrides.setup,
    },
    commandOptions: {
      users: overrides.setup?.targetUser?.id || MOCK_USERS.MEMBER_1.id,
      ...overrides.commandOptions,
    },
    expectations: {
      shouldSucceed: true,
      discordApi: {
        kick: { called: true },
        dmSend: { called: true },
      },
      moderationCase: {
        shouldCreate: true,
        pending: true,
        actionType: ActionType.Kick,
      },
      interaction: {
        deferReply: true,
        editReply: true,
      },
      ...overrides.expectations,
    },
  };
}

/**
 * Creates an unban test case with sensible defaults
 */
export function createUnbanTestCase(
  name: string,
  overrides: BaseTestCaseOverrides = {},
): ModerationTestCase {
  return {
    name,
    actionType: ActionType.BanRemove,
    commandName: "unban",
    setup: {
      guildId: DEFAULT_GUILD_ID,
      executorUser: MOCK_USERS.MODERATOR_1,
      targetUser: MOCK_USERS.MEMBER_1,
      targetExists: true,
      targetIsMember: false, // Unbanned users typically aren't members
      ...overrides.setup,
    },
    commandOptions: {
      users: overrides.setup?.targetUser?.id || MOCK_USERS.MEMBER_1.id,
      ...overrides.commandOptions,
    },
    expectations: {
      shouldSucceed: true,
      discordApi: {
        unban: { called: true },
        dmSend: { called: false }, // Unbans typically don't send DMs
      },
      moderationCase: {
        shouldCreate: true,
        pending: true,
        actionType: ActionType.BanRemove,
      },
      interaction: {
        deferReply: true,
        editReply: true,
      },
      ...overrides.expectations,
    },
  };
}

/**
 * Helper to create DM configuration test variations
 */
export function createDmConfigVariations<T extends ModerationTestCase>(
  baseTestCase: T,
  actionName: string,
): T[] {
  const variations: T[] = [];

  // Guild config true, no override
  variations.push({
    ...baseTestCase,
    name: `${actionName} - uses guild config enabled when dm_reason unspecified`,
    setup: {
      ...baseTestCase.setup,
      guildConfig: {
        ...baseTestCase.setup.guildConfig,
        ...(baseTestCase.actionType === ActionType.Ban
          ? { banDmEnabled: true }
          : { timeoutCommandDmEnabled: true }),
      },
    },
    commandOptions: {
      ...baseTestCase.commandOptions,
      dm_reason: null,
    },
    expectations: {
      ...baseTestCase.expectations,
      discordApi: {
        ...baseTestCase.expectations.discordApi,
        dmSend: { called: true },
      },
    },
  });

  // Guild config false, no override
  variations.push({
    ...baseTestCase,
    name: `${actionName} - uses guild config disabled when dm_reason unspecified`,
    setup: {
      ...baseTestCase.setup,
      targetUser: MOCK_USERS.MEMBER_2,
      guildConfig: {
        ...baseTestCase.setup.guildConfig,
        ...(baseTestCase.actionType === ActionType.Ban
          ? { banDmEnabled: false }
          : { timeoutCommandDmEnabled: false }),
      },
    },
    commandOptions: {
      ...baseTestCase.commandOptions,
      users: MOCK_USERS.MEMBER_2.id,
      dm_reason: null,
    },
    expectations: {
      ...baseTestCase.expectations,
      discordApi: {
        ...baseTestCase.expectations.discordApi,
        dmSend: { called: false },
      },
    },
  });

  // Guild config false, yes_dm override
  variations.push({
    ...baseTestCase,
    name: `${actionName} - dm_reason yes_dm overrides guild config disabled`,
    setup: {
      ...baseTestCase.setup,
      targetUser: MOCK_USERS.MEMBER_3,
      guildConfig: {
        ...baseTestCase.setup.guildConfig,
        ...(baseTestCase.actionType === ActionType.Ban
          ? { banDmEnabled: false }
          : { timeoutCommandDmEnabled: false }),
      },
    },
    commandOptions: {
      ...baseTestCase.commandOptions,
      users: MOCK_USERS.MEMBER_3.id,
      dm_reason: "yes_dm",
    },
    expectations: {
      ...baseTestCase.expectations,
      discordApi: {
        ...baseTestCase.expectations.discordApi,
        dmSend: { called: true },
      },
    },
  });

  // Guild config true, no_dm override
  variations.push({
    ...baseTestCase,
    name: `${actionName} - dm_reason no_dm overrides guild config enabled`,
    setup: {
      ...baseTestCase.setup,
      targetUser: MOCK_USERS.MEMBER_1,
      guildConfig: {
        ...baseTestCase.setup.guildConfig,
        ...(baseTestCase.actionType === ActionType.Ban
          ? { banDmEnabled: true }
          : { timeoutCommandDmEnabled: true }),
      },
    },
    commandOptions: {
      ...baseTestCase.commandOptions,
      users: MOCK_USERS.MEMBER_1.id,
      dm_reason: "no_dm",
    },
    expectations: {
      ...baseTestCase.expectations,
      discordApi: {
        ...baseTestCase.expectations.discordApi,
        dmSend: { called: false },
      },
    },
  });

  return variations;
}
