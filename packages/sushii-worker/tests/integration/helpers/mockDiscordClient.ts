import { Mock, mock } from "bun:test";
import {
  Client,
  Collection,
  DMChannel,
  Guild,
  GuildBan,
  GuildMember,
  User,
} from "discord.js";

import { MockUserData, getMockUserById } from "./mockUsers";

export interface DiscordAPISpies {
  ban: Mock<(userId: string, options?: unknown) => Promise<GuildMember | User>>;
  unban: Mock<(userId: string, reason?: string) => Promise<User>>;
  kick: Mock<(reason?: string) => Promise<GuildMember>>;
  timeout: Mock<
    (duration: number | null, reason?: string) => Promise<GuildMember>
  >;
  send: Mock<(options: unknown) => Promise<unknown>>;
  createDM: Mock<() => Promise<DMChannel>>;
}

export interface MockDiscordClient {
  client: Client;
  spies: DiscordAPISpies;
  addUser: (user: MockUserData) => void;
  addGuild: (guildId: string, guildName?: string) => Guild;
  addGuildMember: (
    guildId: string,
    userId: string,
    memberData?: Partial<GuildMember>,
  ) => void;
  setAvailableUsers: (userIds: string[]) => void;
  setGuildMembers: (guildId: string, memberIds: string[]) => void;
  clearUsers: () => void;
  clearGuildMembers: (guildId: string) => void;
}

/**
 * Creates a minimal mock Discord client with spy functions for API calls.
 * This allows integration tests to verify Discord API interactions without
 * making real network requests.
 */
export function createMockDiscordClient(): MockDiscordClient {
  // Create spy functions
  const banSpy = mock((_userId: string, _options?: unknown) =>
    Promise.resolve({} as User),
  );
  const unbanSpy = mock((_userId: string, _reason?: string) =>
    Promise.resolve({} as User),
  );
  const kickSpy = mock((_reason?: string) =>
    Promise.resolve({} as GuildMember),
  );
  const timeoutSpy = mock((_duration: number | null, _reason?: string) =>
    Promise.resolve({} as GuildMember),
  );
  const sendSpy = mock((_options: unknown) =>
    Promise.resolve({
      id: "message-id",
      channel: { id: "dm-channel-id" },
    }),
  );
  const createDMSpy = mock(() =>
    Promise.resolve({
      id: "dm-channel-id",
      send: sendSpy,
    } as unknown as DMChannel),
  );

  // Store configured users and members
  const availableUsers = new Set<string>();
  const guildMembers = new Map<string, Set<string>>();
  const userCache = new Collection<string, User>();
  const memberDataCache = new Map<string, Map<string, Partial<GuildMember>>>();

  // Create mock client structure
  const mockClient = {
    guilds: {
      cache: new Collection<string, Guild>(),
    },
    users: {
      cache: userCache,
      fetch: mock((userId: string) => {
        if (!availableUsers.has(userId)) {
          return Promise.reject(new Error(`User ${userId} not found`));
        }
        const cachedUser = userCache.get(userId);
        if (cachedUser) {
          return Promise.resolve(cachedUser);
        }
        const mockUserData = getMockUserById(userId);
        if (mockUserData) {
          const user = createMockUserFromData(mockUserData);
          userCache.set(userId, user); // Cache the user for consistency
          return Promise.resolve(user);
        }
        return Promise.reject(new Error(`User ${userId} not found`));
      }),
    },
    channels: {
      fetch: mock((channelId: string) =>
        Promise.resolve({
          id: channelId,
          isTextBased: () => true,
          send: sendSpy,
        }),
      ),
    },
  } as unknown as Client;

  // Helper to add a mock guild to the cache
  const addMockGuild = (guildId: string, guildName: string = "Test Guild") => {
    const mockGuild = {
      id: guildId,
      name: guildName,
      iconURL: () => `https://cdn.discordapp.com/icons/${guildId}/icon.png`,
      members: {
        ban: banSpy,
        unban: unbanSpy,
        cache: new Collection<string, GuildMember>(),
        fetch: mock((userId?: string) => {
          if (userId) {
            const guildMemberSet = guildMembers.get(guildId);
            if (!guildMemberSet || !guildMemberSet.has(userId)) {
              return Promise.reject(
                new Error(`Member ${userId} not found in guild ${guildId}`),
              );
            }

            const memberData = memberDataCache.get(guildId)?.get(userId);
            return Promise.resolve(createMockMember(userId, memberData));
          }

          // Fetch all members
          const guildMemberSet = guildMembers.get(guildId);
          if (!guildMemberSet) {
            return Promise.resolve(new Collection<string, GuildMember>());
          }

          const members = new Collection<string, GuildMember>();
          guildMemberSet.forEach((memberId) => {
            const memberData = memberDataCache.get(guildId)?.get(memberId);
            members.set(memberId, createMockMember(memberId, memberData));
          });
          return Promise.resolve(members);
        }),
      },
      bans: {
        fetch: mock(() => Promise.resolve(new Collection<string, GuildBan>())),
      },
    } as unknown as Guild;

    mockClient.guilds.cache.set(guildId, mockGuild);
    return mockGuild;
  };

  // Helper to create a mock member
  const createMockMember = (
    userId: string,
    memberData?: Partial<GuildMember>,
  ): GuildMember => {
    const mockUserData = getMockUserById(userId);
    const rolePosition =
      memberData?.roles?.highest?.position || mockUserData?.rolePosition || 1;

    return {
      id: userId,
      user: createMockUser(userId),
      roles: memberData?.roles || {
        highest: {
          position: rolePosition,
          id: rolePosition > 5 ? "moderator-role-id" : "member-role-id",
          name: rolePosition > 5 ? "Moderator" : "Member",
        },
        cache: new Map(),
      },
      permissions: {
        has: () => true, // Grant all permissions for testing
      },
      kick: kickSpy,
      timeout: timeoutSpy,
      isCommunicationDisabled: () => false,
      ...memberData,
    } as unknown as GuildMember;
  };

  // Helper to create a mock user from data
  const createMockUserFromData = (userData: MockUserData): User => {
    return {
      id: userData.id,
      tag: userData.tag,
      username: userData.username,
      discriminator: userData.discriminator,
      bot: userData.bot,
      system: userData.system,
      createDM: mock(() =>
        Promise.resolve({
          id: "dm-channel-id",
          send: sendSpy, // Use the global sendSpy
        } as unknown as DMChannel),
      ),
      send: sendSpy, // Use the global sendSpy
      displayAvatarURL: () =>
        `https://cdn.discordapp.com/avatars/${userData.id}/avatar.png`,
    } as unknown as User;
  };

  // Helper to create a mock user
  const createMockUser = (userId: string): User => {
    const mockUserData = getMockUserById(userId);
    if (mockUserData) {
      return createMockUserFromData(mockUserData);
    }
    return {
      id: userId,
      tag: `TestUser#${userId.slice(-4)}`,
      username: `TestUser${userId.slice(-4)}`,
      createDM: mock(() =>
        Promise.resolve({
          id: "dm-channel-id",
          send: sendSpy, // Use the global sendSpy
        } as unknown as DMChannel),
      ),
      send: sendSpy, // Use the global sendSpy
    } as unknown as User;
  };

  return {
    client: mockClient,
    spies: {
      ban: banSpy,
      unban: unbanSpy,
      kick: kickSpy,
      timeout: timeoutSpy,
      send: sendSpy,
      createDM: createDMSpy,
    },
    addUser: (user: MockUserData) => {
      availableUsers.add(user.id);
      const discordUser = createMockUserFromData(user);
      userCache.set(user.id, discordUser);
    },
    addGuild: addMockGuild,
    addGuildMember: (
      guildId: string,
      userId: string,
      memberData?: Partial<GuildMember>,
    ) => {
      let guildMemberSet = guildMembers.get(guildId);
      if (!guildMemberSet) {
        guildMemberSet = new Set();
        guildMembers.set(guildId, guildMemberSet);
      }

      guildMemberSet.add(userId);

      if (memberData) {
        let guildMemberDataCache = memberDataCache.get(guildId);
        if (!guildMemberDataCache) {
          guildMemberDataCache = new Map();
          memberDataCache.set(guildId, guildMemberDataCache);
        }
        guildMemberDataCache.set(userId, memberData);
      }
    },
    setAvailableUsers: (userIds: string[]) => {
      availableUsers.clear();
      userIds.forEach((id) => availableUsers.add(id));
    },
    setGuildMembers: (guildId: string, memberIds: string[]) => {
      guildMembers.set(guildId, new Set(memberIds));
    },
    clearUsers: () => {
      availableUsers.clear();
      userCache.clear();
    },
    clearGuildMembers: (guildId: string) => {
      guildMembers.delete(guildId);
      memberDataCache.delete(guildId);
    },
  };
}

/**
 * Helper to create a mock Discord user
 */
export function createMockUser(
  overrides?: Partial<Omit<User, "toString" | "valueOf">>,
): User {
  const userId = overrides?.id || "123456789";

  // Check if this is a predefined user
  const mockUserData = getMockUserById(userId);
  if (mockUserData) {
    return {
      id: mockUserData.id,
      tag: mockUserData.tag,
      username: mockUserData.username,
      discriminator: mockUserData.discriminator,
      bot: mockUserData.bot,
      system: mockUserData.system,
      displayAvatarURL: () =>
        `https://cdn.discordapp.com/avatars/${mockUserData.id}/avatar.png`,
      createDM: mock(() =>
        Promise.resolve({
          id: "dm-channel-id",
          send: mock(() =>
            Promise.resolve({
              id: "message-id",
              channel: { id: "dm-channel-id" },
            }),
          ),
        } as unknown as DMChannel),
      ),
      send: mock(() =>
        Promise.resolve({
          id: "message-id",
          channel: { id: "dm-channel-id" },
        }),
      ), // Add send method for direct DM
      ...overrides,
    } as User;
  }

  // Fallback for non-predefined users
  return {
    id: userId,
    tag: `TestUser#${userId.slice(-4)}`,
    username: `TestUser${userId.slice(-4)}`,
    displayAvatarURL: () =>
      `https://cdn.discordapp.com/avatars/${userId}/avatar.png`,
    createDM: mock(() =>
      Promise.resolve({
        id: "dm-channel-id",
        send: mock(() => Promise.resolve({ id: "message-id" })),
      } as unknown as DMChannel),
    ),
    send: mock(() =>
      Promise.resolve({
        id: "message-id",
        channel: { id: "dm-channel-id" },
      }),
    ),
    ...overrides,
  } as User;
}

/**
 * Helper to create a mock Discord guild member
 */
export function createMockGuildMember(
  overrides?: Partial<Omit<GuildMember, "toString" | "valueOf">>,
): GuildMember {
  const memberId = overrides?.id || "123456789";
  const mockUserData = getMockUserById(memberId);
  const rolePosition =
    overrides?.roles?.highest?.position || mockUserData?.rolePosition || 1;

  return {
    id: memberId,
    user: overrides?.user || createMockUser({ id: memberId }),
    roles: overrides?.roles || {
      highest: {
        position: rolePosition,
        id: rolePosition > 5 ? "moderator-role-id" : "member-role-id",
        name: rolePosition > 5 ? "Moderator" : "Member",
      },
      cache: new Map(),
    },
    permissions: {
      has: () => true, // Grant all permissions for testing
    },
    kick: mock(() => Promise.resolve({} as GuildMember)),
    timeout: mock(() => Promise.resolve({} as GuildMember)),
    isCommunicationDisabled: () => false,
    ...overrides,
  } as GuildMember;
}
