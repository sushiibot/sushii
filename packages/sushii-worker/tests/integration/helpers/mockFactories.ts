import type { Mock} from "bun:test";
import { mock } from "bun:test";
import type {
  AuditLogEvent,
  ChatInputCommandInteraction,
  Guild,
  GuildAuditLogsEntry,
  GuildMember,
  GuildMemberRoleManager,
  Role,
  Snowflake,
  User} from "discord.js";
import {
  ApplicationCommandType,
  Collection,
  InteractionType
} from "discord.js";

import { createMockGuildMember } from "./mockDiscordClient";
import { getMockUserById } from "./mockUsers";

export interface InteractionSpies {
  reply: Mock<() => Promise<unknown>>;
  deferReply: Mock<() => Promise<unknown>>;
  editReply: Mock<() => Promise<unknown>>;
  followUp: Mock<() => Promise<unknown>>;
  options: {
    getString: Mock<(name: string) => string | null>;
    getUser: Mock<(name: string) => User | null>;
    getMember: Mock<(name: string) => unknown>;
    getInteger: Mock<(name: string) => number | null>;
    getBoolean: Mock<(name: string) => boolean | null>;
    getChannel: Mock<(name: string) => unknown>;
    getSubcommand: Mock<(required?: boolean) => string | null>;
    getSubcommandGroup: Mock<(required?: boolean) => string | null>;
    getAttachment: Mock<(name: string) => unknown>;
    getNumber: Mock<(name: string) => number | null>;
    getRole: Mock<(name: string) => unknown>;
    getMentionable: Mock<(name: string) => unknown>;
  };
  guild: {
    membersFetch: Mock<() => Promise<unknown>>;
  };
}

export interface GuildSpies {
  membersFetch: Mock<() => Promise<unknown>>;
  userFetch: Mock<(userId: string) => Promise<User>>;
}

export interface MockInteractionResult {
  interaction: ChatInputCommandInteraction;
  spies: InteractionSpies;
}

export interface MockGuildResult {
  guild: Guild;
  spies: GuildSpies;
}

/**
 * Creates a mock slash command interaction for testing
 */
export function createMockSlashCommandInteraction(options: {
  commandName: string;
  guildId: string;
  user: User;
  options?: Record<string, unknown>;
  guild?: Guild;
}): MockInteractionResult {
  const {
    commandName,
    guildId,
    user,
    options: cmdOptions = {},
    guild,
  } = options;

  // Mock option getters
  const optionSpies = {
    getString: mock((name: string) => cmdOptions[name]?.toString() || null),
    getUser: mock((name: string) => (cmdOptions[name] as User) || null),
    getMember: mock((name: string) =>
      cmdOptions[name]
        ? createMockGuildMember({ user: cmdOptions[name] as User })
        : null,
    ),
    getInteger: mock((name: string) => (cmdOptions[name] as number) || null),
    getBoolean: mock((name: string) => (cmdOptions[name] as boolean) || null),
    getChannel: mock((name: string) => cmdOptions[name] || null),
    getSubcommand: mock((_required?: boolean) => null),
    getSubcommandGroup: mock((_required?: boolean) => null),
    getAttachment: mock((_name: string) => null),
    getNumber: mock((name: string) => (cmdOptions[name] as number) || null),
    getRole: mock((_name: string) => null),
    getMentionable: mock((_name: string) => null),
  };

  // Mock reply/deferReply functions
  const replySpy = mock(() => Promise.resolve({ id: "reply-id" }));
  const deferReplySpy = mock(() => Promise.resolve({ id: "defer-id" }));
  const editReplySpy = mock(() => Promise.resolve({ id: "edit-id" }));
  const followUpSpy = mock(() => Promise.resolve({ id: "followup-id" }));

  // Mock guild members fetch - this is a simplified version for interactions
  // The actual fetch behavior should be handled by the MockDiscordClient
  const membersFetchSpy = mock((userId?: string) => {
    if (userId) {
      // Get the user data to determine role position
      const userData = getMockUserById(userId);
      const rolePosition = userData?.rolePosition || 1;

      return Promise.resolve(
        createMockGuildMember({
          id: userId,
          roles: {
            highest: {
              position: rolePosition,
              id: rolePosition > 5 ? "moderator-role-id" : "member-role-id",
              name: rolePosition > 5 ? "Moderator" : "Member",
            } as Role,
            cache: new Collection<Snowflake, Role>(),
          } as GuildMemberRoleManager,
        }),
      );
    }
    return Promise.resolve();
  });

  const mockGuild =
    guild ||
    ({
      id: guildId,
      name: "Test Guild",
      members: {
        cache: new Collection<Snowflake, GuildMember>(),
        fetch: membersFetchSpy,
      },
    } as unknown as Guild);

  const interaction = {
    type: InteractionType.ApplicationCommand,
    commandType: ApplicationCommandType.ChatInput,
    commandName,
    commandId: "command-id",
    applicationId: "app-id",
    channelId: "channel-id",
    guildId,
    guild: mockGuild,
    user,
    member: createMockGuildMember({
      id: user.id,
      user,
      guild: mockGuild,
    }),
    options: optionSpies,
    reply: replySpy,
    deferReply: deferReplySpy,
    editReply: editReplySpy,
    followUp: followUpSpy,
    isCommand: () => true,
    isChatInputCommand: () => true,
    inGuild: () => true,
    inCachedGuild: () => true,
    createdTimestamp: Date.now(),
    id: "interaction-id",
  } as unknown as ChatInputCommandInteraction;

  const spies: InteractionSpies = {
    reply: replySpy,
    deferReply: deferReplySpy,
    editReply: editReplySpy,
    followUp: followUpSpy,
    options: optionSpies,
    guild: {
      membersFetch: membersFetchSpy,
    },
  };

  return { interaction, spies };
}

/**
 * Creates a mock audit log entry for testing
 */
export function createMockAuditLogEntry(options: {
  action: AuditLogEvent;
  targetId: string;
  executorId: string;
  reason?: string;
  guildId: string;
  changes?: unknown[];
}): GuildAuditLogsEntry {
  const { action, targetId, executorId, reason, changes = [] } = options;

  return {
    id: Date.now().toString(), // Use timestamp as snowflake-like ID
    action,
    targetId,
    executorId,
    reason,
    changes,
    extra: null,
    actionType: "Update", // or "Create", "Delete"
    targetType: "User",
    createdTimestamp: Date.now(),
    createdAt: new Date(),
  } as unknown as GuildAuditLogsEntry;
}

/**
 * Creates a mock ban command interaction
 */
export function createMockBanInteraction(options: {
  guildId: string;
  executor: User;
  users: string;
  reason?: string;
  guild?: Guild;
}): MockInteractionResult {
  return createMockSlashCommandInteraction({
    commandName: "ban",
    guildId: options.guildId,
    user: options.executor,
    guild: options.guild,
    options: {
      users: options.users,
      reason: options.reason || "No reason provided",
    },
  });
}

/**
 * Creates a mock timeout/mute command interaction
 */
export function createMockTimeoutInteraction(options: {
  guildId: string;
  executor: User;
  target: User;
  duration: string;
  reason?: string;
}): MockInteractionResult {
  return createMockSlashCommandInteraction({
    commandName: "timeout",
    guildId: options.guildId,
    user: options.executor,
    options: {
      user: options.target,
      duration: options.duration,
      reason: options.reason || "No reason provided",
    },
  });
}

/**
 * Creates a mock guild for testing
 */
export function createMockGuild(
  overrides?: Partial<Omit<Guild, "valueOf" | "toString">>,
): MockGuildResult {
  const guildId = overrides?.id || "test-guild-123";

  const membersFetchSpy = mock((userId?: string) => {
    if (userId) {
      // Get the user data to determine role position
      const userData = getMockUserById(userId);
      const rolePosition = userData?.rolePosition || 1;

      return Promise.resolve(
        createMockGuildMember({
          id: userId,
          roles: {
            highest: {
              position: rolePosition,
              id: rolePosition > 5 ? "moderator-role-id" : "member-role-id",
              name: rolePosition > 5 ? "Moderator" : "Member",
            } as Role,
            cache: new Collection<Snowflake, Role>(),
          } as GuildMemberRoleManager,
        }),
      );
    }
    return Promise.resolve();
  });

  const userFetchSpy = mock((userId: string) => {
    const userData = getMockUserById(userId);
    if (userData) {
      return Promise.resolve({
        id: userData.id,
        tag: userData.tag,
        username: userData.username,
        discriminator: userData.discriminator,
        bot: userData.bot,
        system: userData.system,
      } as User);
    }
    return Promise.reject(new Error(`User ${userId} not found`));
  });

  const guild = {
    id: guildId,
    name: overrides?.name || "Test Guild",
    ownerId: "owner-123",
    members: {
      cache: new Map(),
      fetch: membersFetchSpy,
    },
    client: {
      users: {
        fetch: userFetchSpy,
      },
    },
    ...overrides,
  } as Guild;

  const spies: GuildSpies = {
    membersFetch: membersFetchSpy,
    userFetch: userFetchSpy,
  };

  return { guild, spies };
}
