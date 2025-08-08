import type { User } from "discord.js";

export interface MockUserData
  extends Partial<Omit<User, "toString" | "valueOf">> {
  id: string;
  username: string;
  discriminator: string;
  tag: string;
  bot?: boolean;
  rolePosition?: number; // For when used as a guild member
}

/**
 * Predefined mock users for integration tests.
 * These users can be selectively added to the mock Discord client
 * to test different scenarios.
 */
export const MOCK_USERS = {
  // Moderators with high role positions
  MODERATOR_1: {
    id: "100000000000000001",
    username: "ModeratorAlpha",
    discriminator: "0001",
    tag: "ModeratorAlpha#0001",
    bot: false,
    rolePosition: 10,
  },
  MODERATOR_2: {
    id: "100000000000000002",
    username: "ModeratorBeta",
    discriminator: "0002",
    tag: "ModeratorBeta#0002",
    bot: false,
    rolePosition: 10,
  },
  MODERATOR_3: {
    id: "100000000000000003",
    username: "ModeratorGamma",
    discriminator: "0003",
    tag: "ModeratorGamma#0003",
    bot: false,
    rolePosition: 9,
  },

  // Regular members with low role positions
  MEMBER_1: {
    id: "200000000000000001",
    username: "MemberAlpha",
    discriminator: "1001",
    tag: "MemberAlpha#1001",
    bot: false,
    rolePosition: 1,
  },
  MEMBER_2: {
    id: "200000000000000002",
    username: "MemberBeta",
    discriminator: "1002",
    tag: "MemberBeta#1002",
    bot: false,
    rolePosition: 1,
  },
  MEMBER_3: {
    id: "200000000000000003",
    username: "MemberGamma",
    discriminator: "1003",
    tag: "MemberGamma#1003",
    bot: false,
    rolePosition: 1,
  },
  MEMBER_4: {
    id: "200000000000000004",
    username: "MemberDelta",
    discriminator: "1004",
    tag: "MemberDelta#1004",
    bot: false,
    rolePosition: 1,
  },

  // Special users
  BOT_USER: {
    id: "300000000000000001",
    username: "TestBot",
    discriminator: "9999",
    tag: "TestBot#9999",
    bot: true,
    rolePosition: 5,
  },
  GUILD_OWNER: {
    id: "400000000000000001",
    username: "GuildOwner",
    discriminator: "0000",
    tag: "GuildOwner#0000",
    bot: false,
    rolePosition: 100, // Highest position
  },
} as const satisfies Record<string, MockUserData>;

/**
 * Helper to get a mock user by ID
 */
export function getMockUserById(userId: string): MockUserData | undefined {
  return Object.values(MOCK_USERS).find((user) => user.id === userId);
}

/**
 * Helper to get multiple mock users by their keys
 */
export function getMockUsers(
  ...keys: (keyof typeof MOCK_USERS)[]
): MockUserData[] {
  return keys.map((key) => MOCK_USERS[key]);
}

/**
 * Helper to get all moderator users
 */
export function getModerators(): MockUserData[] {
  return Object.entries(MOCK_USERS)
    .filter(([key]) => key.startsWith("MODERATOR_"))
    .map(([, user]) => user);
}

/**
 * Helper to get all member users
 */
export function getMembers(): MockUserData[] {
  return Object.entries(MOCK_USERS)
    .filter(([key]) => key.startsWith("MEMBER_"))
    .map(([, user]) => user);
}
