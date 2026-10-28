import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { DMChannel } from "discord.js";
import {
  type Client,
  DiscordAPIError,
  type Guild,
  type GuildMember,
  RESTJSONErrorCodes,
  type User,
} from "discord.js";
import type { Channel } from "discord.js";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pino from "pino";
import { Err, Ok } from "ts-results";

import type { PermissionUsageRecorder } from "@/features/permission-audit";
import type * as schema from "@/infrastructure/database/schema";
import { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import { type GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { type DMNotificationService } from "../../shared/application/DMNotificationService";
import { SoftbanSuppressionSet } from "../../shared/application/SoftbanSuppressionSet";
import {
  BanAction,
  KickAction,
  SoftbanAction,
  TempBanAction,
  WarnAction,
} from "../../shared/domain/entities/ModerationAction";
import { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type {
  DMFailureReason,
  DMIntentSource,
} from "../../shared/domain/entities/ModerationCase";
import { ModerationTarget } from "../../shared/domain/entities/ModerationTarget";
import { type ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import { type TempBanRepository } from "../../shared/domain/repositories/TempBanRepository";
import { type ModLogService } from "../../shared/domain/services/ModLogService";
import { ActionType } from "../../shared/domain/value-objects/ActionType";
import { Duration } from "../../shared/domain/value-objects/Duration";
import { Reason } from "../../shared/domain/value-objects/Reason";
import { type DMPolicyService } from "./DMPolicyService";
import {
  CompleteExecutionContext,
  ExecutionContext,
  ExecutionContextWithCaseId,
} from "./ExecutionContext";
import {
  ModerationExecutionPipeline,
  buildAuditLogReason,
} from "./ModerationExecutionPipeline";

// Mock factories

// Mock factories
function createMockUser(): User {
  return {
    id: "123456789",
    tag: "TestUser#1234",
    createDM: mock(
      () =>
        Promise.resolve({
          id: "dm-channel-id",
          send: mock(() =>
            Promise.resolve({
              id: "message-id",
            }),
          ),
        }) as unknown as DMChannel,
    ),
  } as unknown as User;
}

function createMockMember(): GuildMember {
  return {
    id: "123456789",
    user: createMockUser(),
    ban: mock(() => Promise.resolve()),
    kick: mock(() => Promise.resolve()),
    timeout: mock(() => Promise.resolve()),
  } as unknown as GuildMember;
}

function createMockGuild(): Guild {
  return {
    id: "guild-123",
    name: "Test Guild",
    members: {
      ban: mock(() => Promise.resolve()),
      unban: mock(() => Promise.resolve()),
    },
  } as unknown as Guild;
}

function createMockClient(): Client {
  return {
    guilds: {
      cache: {
        get: () => createMockGuild(),
      },
    },
    channels: {
      fetch: mock(
        () =>
          Promise.resolve({
            isTextBased: () => true,
            messages: {
              delete: mock(() => Promise.resolve()),
            },
          }) as unknown as Channel,
      ),
    },
  } as unknown as Client;
}

function createMockTarget(hasMember: boolean = true): ModerationTarget {
  return new ModerationTarget(
    createMockUser(),
    hasMember ? createMockMember() : null,
  );
}

function createMockReason(): Reason {
  const result = Reason.create("Test reason");
  if (result.ok && result.val !== null) {
    return result.val;
  }
  throw new Error(
    `Failed to create reason: ${result.ok ? "null value" : result.val}`,
  );
}

function createMockDuration(): Duration {
  const result = Duration.create("1d");
  if (result.ok && result.val !== null) {
    return result.val;
  }
  throw new Error(
    `Failed to create duration: ${result.ok ? "null value" : result.val}`,
  );
}

function createMockTransaction(): NodePgDatabase<typeof schema> {
  return {} as NodePgDatabase<typeof schema>;
}

function createMockGuildConfig(guildId = "guild-123"): GuildConfig {
  return GuildConfig.createDefault(guildId);
}

// Silent logger for tests
const testLogger = pino({ level: "silent" });

describe("ModerationExecutionPipeline", () => {
  const mockGuildId = "guild-123";
  let pipeline: ModerationExecutionPipeline;
  let mockDb: NodePgDatabase<typeof schema>;
  let mockModLogRepository: ModLogRepository;
  let mockTempBanRepository: TempBanRepository;
  let mockModLogService: ModLogService;
  let mockDMPolicyService: DMPolicyService;
  let mockDMNotificationService: DMNotificationService;
  let mockGuildConfigRepository: GuildConfigRepository;
  let mockClient: Client;
  let mockPermissionUsageRecorder: PermissionUsageRecorder;
  let mockModLogMessageService: { refresh: ReturnType<typeof mock> };

  beforeEach(() => {
    // Create fresh mocks for each test
    mockDb = {
      transaction: mock((callback) => callback(mockDb)),
    } as unknown as NodePgDatabase<typeof schema>;

    mockModLogRepository = {
      createCase: mock((caseData) => {
        // Return the created case with auto-generated ID
        const createdCase = new ModerationCase(
          caseData.guildId,
          "1", // Auto-generated ID
          caseData.actionType,
          caseData.actionTime,
          caseData.userId,
          caseData.userTag,
          caseData.executorId,
          caseData.reason,
          caseData.msgId,
          caseData.attachments,
          caseData.dmResult,
          caseData.pending,
          caseData.timeoutDuration,
          caseData.dmIntended,
          caseData.dmIntentSource,
          caseData.dmAttempted,
          caseData.dmNotAttemptedReason,
          caseData.dmFailureReason,
        );
        return Promise.resolve(createdCase);
      }),
      update: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve()),
      findById: mock(() => Promise.resolve(null)),
      findByUserIdNotPending: mock(() => Promise.resolve([])),
      findByUserIdsNotPending: mock(() => Promise.resolve([])),
      findByGuildId: mock(() => Promise.resolve([])),
      deleteRange: mock(() => Promise.resolve([])),
      exists: mock(() => Promise.resolve(true)),
      findByRange: mock(() => Promise.resolve([])),
      updateReasonBulk: mock(() => Promise.resolve([])),
      searchByIdPrefix: mock(() => Promise.resolve([])),
      findRecent: mock(() => Promise.resolve([])),
      // Audit log methods
      findPendingCase: mock(() => Promise.resolve(null)),
      markAsNotPending: mock(() => Promise.resolve({} as ModerationCase)),
      updateMessageId: mock(() => Promise.resolve()),
      updateDMInfo: mock(() => Promise.resolve()),
      hasAnyForGuild: mock(() => Promise.resolve(false)),
      findByIds: mock(() => Promise.resolve([])),
      markDmDeleted: mock(() => Promise.resolve()),
      findLastReason: mock(() => Promise.resolve(null)),
      findRecentDistinctReasons: mock(() => Promise.resolve([])),
      countByNormalizedReason: mock(() => Promise.resolve(0)),
    };

    mockTempBanRepository = {
      save: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve(null)),
      findByGuildId: mock(() => Promise.resolve([])),
      findByGuildAndUserId: mock(() => Promise.resolve(null)),
      findExpired: mock(() => Promise.resolve([])),
      deleteExpired: mock(() => Promise.resolve([])),
    };

    mockModLogService = {
      shouldPostToModLog: mock(
        (actionType: ActionType) => actionType === ActionType.Warn,
      ),
      sendModLog: mock(() => Promise.resolve(Ok("test-message-id"))),
    };

    mockDMPolicyService = {
      shouldSendDM: mock(() =>
        Promise.resolve({
          should: false,
          source: "guild_default" as DMIntentSource,
        }),
      ),
    } as unknown as DMPolicyService;

    mockDMNotificationService = {
      sendModerationDM: mock(() =>
        Promise.resolve(
          Ok({
            channelId: "dm-channel-id",
            messageId: "message-id",
            error: null,
          }),
        ),
      ),
    } as unknown as DMNotificationService;

    mockGuildConfigRepository = {
      findByGuildId: mock(() =>
        Promise.resolve(GuildConfig.createDefault(mockGuildId)),
      ),
    } as unknown as GuildConfigRepository;

    mockClient = createMockClient();
    mockPermissionUsageRecorder = {
      recordSushiiAction: mock(() => Promise.resolve()),
    } as unknown as PermissionUsageRecorder;

    mockModLogMessageService = { refresh: mock(async () => "updated") };

    pipeline = new ModerationExecutionPipeline(
      mockDb,
      mockModLogRepository,
      mockTempBanRepository,
      mockModLogService,
      mockDMPolicyService,
      mockDMNotificationService,
      mockGuildConfigRepository,
      mockClient,
      testLogger,
      new SoftbanSuppressionSet(),
      mockPermissionUsageRecorder,
      mockModLogMessageService,
    );
  });

  describe("successful execution flow", () => {
    test("should execute simple warn action successfully", async () => {
      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val).toBeInstanceOf(ModerationCase);
        expect(result.val.actionType).toBe(ActionType.Warn);
        expect(result.val.userId).toBe(target.id);
      }
    });

    test("should execute ban action successfully", async () => {
      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Ban,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val).toBeInstanceOf(ModerationCase);
        expect(result.val.actionType).toBe(ActionType.Ban);
      }
    });

    test("records Ban Members usage for the moderator", async () => {
      const executor = createMockUser();
      const action = new BanAction(
        mockGuildId,
        executor,
        null,
        createMockReason(),
        "unspecified",
      );

      await pipeline.execute(
        action,
        ActionType.Ban,
        createMockTarget(),
        createMockGuildConfig(),
      );

      expect(
        mockPermissionUsageRecorder.recordSushiiAction,
      ).toHaveBeenCalledWith({
        guildId: mockGuildId,
        userId: executor.id,
        permission: "BanMembers",
        channelId: null,
      });
    });

    test("records no usage for a warn", async () => {
      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );

      await pipeline.execute(
        action,
        ActionType.Warn,
        createMockTarget(),
        createMockGuildConfig(),
      );

      expect(
        mockPermissionUsageRecorder.recordSushiiAction,
      ).not.toHaveBeenCalled();
    });

    test("should execute kick action successfully", async () => {
      const action = new KickAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Kick,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val).toBeInstanceOf(ModerationCase);
        expect(result.val.actionType).toBe(ActionType.Kick);
      }
    });
  });

  describe("createCase stage", () => {
    test("should throw when case creation fails", async () => {
      // Override mock for this test
      mockModLogRepository.createCase = mock(() =>
        Promise.reject(new Error("connection lost")),
      );

      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      await expect(
        pipeline.execute(
          action,
          ActionType.Warn,
          target,
          createMockGuildConfig(),
        ),
      ).rejects.toThrow("connection lost");
    });

    test("should not run the Discord action when case creation fails", async () => {
      mockModLogRepository.createCase = mock(() =>
        Promise.reject(new Error("connection lost")),
      );

      const guild = createMockGuild();
      const client = {
        guilds: { cache: { get: () => guild } },
      } as unknown as Client;

      const pipelineWithGuild = new ModerationExecutionPipeline(
        mockDb,
        mockModLogRepository,
        mockTempBanRepository,
        mockModLogService,
        mockDMPolicyService,
        mockDMNotificationService,
        mockGuildConfigRepository,
        client,
        testLogger,
        new SoftbanSuppressionSet(),
        mockPermissionUsageRecorder,
        mockModLogMessageService,
      );

      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );

      await expect(
        pipelineWithGuild.execute(
          action,
          ActionType.Ban,
          createMockTarget(),
          createMockGuildConfig(),
        ),
      ).rejects.toThrow("connection lost");
      expect(guild.members.ban).not.toHaveBeenCalled();
    });
  });

  describe("DM handling", () => {
    test("should send DM when policy allows", async () => {
      // Override mock for this test
      mockDMPolicyService.shouldSendDM = mock(() =>
        Promise.resolve({
          should: true,
          source: "guild_default" as DMIntentSource,
        }),
      );

      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.dmResult?.messageId).toBe("message-id");
        expect(result.val.dmResult?.channelId).toBe("dm-channel-id");
      }
    });

    test("re-renders an entry the audit log already posted once the DM result is saved", async () => {
      mockDMPolicyService.shouldSendDM = mock(() =>
        Promise.resolve({
          should: true,
          source: "guild_default" as DMIntentSource,
        }),
      );
      const posted = { msgId: "1029384756102938499" } as ModerationCase;
      mockModLogRepository.findById = mock(() => Promise.resolve(posted));

      const result = await pipeline.execute(
        new BanAction(
          mockGuildId,
          createMockUser(),
          null,
          createMockReason(),
          "unspecified",
        ),
        ActionType.Ban,
        createMockTarget(),
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      expect(mockModLogMessageService.refresh).toHaveBeenCalledWith(posted);
    });

    test("a failed re-render doesn't fail the action", async () => {
      mockDMPolicyService.shouldSendDM = mock(() =>
        Promise.resolve({
          should: true,
          source: "guild_default" as DMIntentSource,
        }),
      );
      mockModLogRepository.findById = mock(() =>
        Promise.resolve({ msgId: "1" } as ModerationCase),
      );
      mockModLogMessageService.refresh.mockRejectedValueOnce(new Error("boom"));

      const result = await pipeline.execute(
        new BanAction(
          mockGuildId,
          createMockUser(),
          null,
          createMockReason(),
          "unspecified",
        ),
        ActionType.Ban,
        createMockTarget(),
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
    });

    test("no posted entry yet: nothing to re-render", async () => {
      mockDMPolicyService.shouldSendDM = mock(() =>
        Promise.resolve({
          should: true,
          source: "guild_default" as DMIntentSource,
        }),
      );

      await pipeline.execute(
        new BanAction(
          mockGuildId,
          createMockUser(),
          null,
          createMockReason(),
          "unspecified",
        ),
        ActionType.Ban,
        createMockTarget(),
        createMockGuildConfig(),
      );

      expect(mockModLogMessageService.refresh).not.toHaveBeenCalled();
    });

    test("should skip DM when policy denies", async () => {
      // mockDMPolicyService.shouldSendDM already returns false by default

      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.dmResult).toBeNull();
      }
    });

    test("should fail to create case when warning DM fails", async () => {
      // Override mock to enable DM policy for warnings
      mockDMPolicyService.shouldSendDM = mock(() =>
        Promise.resolve({
          should: true,
          source: "warn_always" as DMIntentSource,
        }),
      );

      // Override mock to simulate DM failure (real impl returns Ok with error field)
      mockDMNotificationService.sendModerationDM = mock(() =>
        Promise.resolve(
          Ok({
            channelId: null,
            messageId: null,
            error: "Failed to send DM: User has DMs disabled",
            failureReason: "user_privacy" as DMFailureReason,
          }),
        ),
      );

      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.val).toContain("Failed to send DM");
      }

      // Verify no case was created
      expect(mockModLogRepository.createCase).not.toHaveBeenCalled();
    });

    test("should not leak raw error text when warning DM fails unexpectedly", async () => {
      mockDMPolicyService.shouldSendDM = mock(() =>
        Promise.resolve({
          should: true,
          source: "warn_always" as DMIntentSource,
        }),
      );

      mockDMNotificationService.sendModerationDM = mock(() =>
        Promise.resolve(
          Ok({
            channelId: null,
            messageId: null,
            error: "socket hang up",
            failureReason: null,
          }),
        ),
      );

      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        createMockTarget(),
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.val).toBe("Failed to send warning DM");
      }
    });
  });

  describe("Discord action execution", () => {
    test("should skip Discord action for warn actions", async () => {
      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      // No specific assertions needed - just ensuring it doesn't fail
    });

    test("should execute Discord action for ban actions", async () => {
      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Ban,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
    });

    test("should execute softban action (ban + unban)", async () => {
      const guild = createMockGuild();
      const clientWithGuild = {
        guilds: { cache: { get: () => guild } },
        channels: { fetch: mock(() => Promise.resolve(null)) },
      } as unknown as Client;

      const pipelineWithGuild = new ModerationExecutionPipeline(
        mockDb,
        mockModLogRepository,
        mockTempBanRepository,
        mockModLogService,
        mockDMPolicyService,
        mockDMNotificationService,
        mockGuildConfigRepository,
        clientWithGuild,
        testLogger,
        new SoftbanSuppressionSet(),
        mockPermissionUsageRecorder,
        mockModLogMessageService,
      );

      const action = new SoftbanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
        3600,
      );
      const target = createMockTarget();

      const result = await pipelineWithGuild.execute(
        action,
        ActionType.Softban,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      expect(guild.members.ban).toHaveBeenCalledWith(target.id, {
        reason: expect.any(String),
        deleteMessageSeconds: 3600,
      });
      expect(guild.members.unban).toHaveBeenCalledWith(
        target.id,
        expect.any(String),
      );
    });

    test("should fail when Discord API call fails", async () => {
      // Mock guild to throw error on ban
      const mockGuildWithError = {
        id: "guild-123",
        name: "Test Guild",
        members: {
          ban: mock(() => {
            throw new Error("Discord API error");
          }),
        },
      } as unknown as Guild;

      const mockClientWithError = {
        guilds: {
          cache: {
            get: () => mockGuildWithError,
          },
        },
      } as unknown as Client;

      const pipelineWithError = new ModerationExecutionPipeline(
        mockDb,
        mockModLogRepository,
        mockTempBanRepository,
        mockModLogService,
        mockDMPolicyService,
        mockDMNotificationService,
        mockGuildConfigRepository,
        mockClientWithError,
        testLogger,
        new SoftbanSuppressionSet(),
        mockPermissionUsageRecorder,
        mockModLogMessageService,
      );

      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      await expect(
        pipelineWithError.execute(
          action,
          ActionType.Ban,
          target,
          createMockGuildConfig(),
        ),
      ).rejects.toThrow("Discord API error");
    });

    test("should return a friendly error when Discord rejects with missing permissions", async () => {
      const permissionError = new DiscordAPIError(
        {
          message: "Missing Permissions",
          code: RESTJSONErrorCodes.MissingPermissions,
        },
        RESTJSONErrorCodes.MissingPermissions,
        403,
        "PUT",
        "/guilds/guild-123/bans/user-123",
        {},
      );

      const mockGuildWithError = {
        members: {
          ban: mock(() => Promise.reject(permissionError)),
        },
      } as unknown as Guild;

      const pipelineWithError = new ModerationExecutionPipeline(
        mockDb,
        mockModLogRepository,
        mockTempBanRepository,
        mockModLogService,
        mockDMPolicyService,
        mockDMNotificationService,
        mockGuildConfigRepository,
        {
          guilds: { cache: { get: () => mockGuildWithError } },
        } as unknown as Client,
        testLogger,
        new SoftbanSuppressionSet(),
        mockPermissionUsageRecorder,
        mockModLogMessageService,
      );

      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );

      const result = await pipelineWithError.execute(
        action,
        ActionType.Ban,
        createMockTarget(),
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.val).toContain("Bot is missing permissions");
      }
      expect(mockModLogRepository.delete).toHaveBeenCalled();
    });
  });

  describe("temp ban management", () => {
    test("should create temp ban record for TempBan actions", async () => {
      const action = new TempBanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
        createMockDuration(),
      );

      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.TempBan,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      expect(mockTempBanRepository.save).toHaveBeenCalled();
    });

    test("should throw when temp ban save fails", async () => {
      // Override mock for this test
      mockTempBanRepository.save = mock(() =>
        Promise.reject(new Error("Failed to save temp ban")),
      );

      const action = new TempBanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
        createMockDuration(),
      );

      const target = createMockTarget();

      // Temp ban failure fails the entire transaction for atomicity
      await expect(
        pipeline.execute(
          action,
          ActionType.TempBan,
          target,
          createMockGuildConfig(),
        ),
      ).rejects.toThrow("Failed to save temp ban");
    });
  });

  describe("mod log handling", () => {
    test("should send mod log for warn actions", async () => {
      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        target,
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      expect(mockModLogService.sendModLog).toHaveBeenCalled();
    });

    test("should handle mod log failure gracefully", async () => {
      // Override mock for this test
      mockModLogService.sendModLog = mock(() =>
        Promise.resolve(Err("Failed to send mod log")),
      );

      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        target,
        createMockGuildConfig(),
      );

      // Should still succeed as mod log failure doesn't fail the entire operation
      expect(result.ok).toBe(true);
    });

    test("should succeed when saving the mod log message ID fails", async () => {
      mockModLogRepository.updateMessageId = mock(() =>
        Promise.reject(new Error("connection lost")),
      );

      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );

      const result = await pipeline.execute(
        action,
        ActionType.Warn,
        createMockTarget(),
        createMockGuildConfig(),
      );

      expect(result.ok).toBe(true);
      expect(mockModLogRepository.updateMessageId).toHaveBeenCalled();
    });
  });

  describe("cleanup on failure", () => {
    test("should cleanup case when pipeline fails", async () => {
      // Force failure after case creation by making Discord action fail
      const mockGuildWithError = {
        members: {
          ban: mock(() => {
            throw new Error("Discord API error");
          }),
        },
      } as unknown as Guild;

      const mockClientWithError = {
        guilds: {
          cache: {
            get: () => mockGuildWithError,
          },
        },
      } as unknown as Client;

      const pipelineWithError = new ModerationExecutionPipeline(
        mockDb,
        mockModLogRepository,
        mockTempBanRepository,
        mockModLogService,
        mockDMPolicyService,
        mockDMNotificationService,
        mockGuildConfigRepository,
        mockClientWithError,
        testLogger,
        new SoftbanSuppressionSet(),
        mockPermissionUsageRecorder,
        mockModLogMessageService,
      );

      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      await expect(
        pipelineWithError.execute(
          action,
          ActionType.Ban,
          target,
          createMockGuildConfig(),
        ),
      ).rejects.toThrow("Discord API error");

      expect(mockModLogRepository.createCase).toHaveBeenCalled();
      expect(mockModLogRepository.delete).toHaveBeenCalled();
    });

    test("should rethrow the original error when cleanup also fails", async () => {
      // Override mock for this test
      mockModLogRepository.delete = mock(() =>
        Promise.reject(new Error("Failed to delete case")),
      );

      // Force failure after case creation
      const mockGuildWithError = {
        members: {
          ban: mock(() => {
            throw new Error("Discord API error");
          }),
        },
      } as unknown as Guild;

      const mockClientWithError = {
        guilds: {
          cache: {
            get: () => mockGuildWithError,
          },
        },
      } as unknown as Client;

      const pipelineWithError = new ModerationExecutionPipeline(
        mockDb,
        mockModLogRepository,
        mockTempBanRepository,
        mockModLogService,
        mockDMPolicyService,
        mockDMNotificationService,
        mockGuildConfigRepository,
        mockClientWithError,
        testLogger,
        new SoftbanSuppressionSet(),
        mockPermissionUsageRecorder,
        mockModLogMessageService,
      );

      const action = new BanAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();

      await expect(
        pipelineWithError.execute(
          action,
          ActionType.Ban,
          target,
          createMockGuildConfig(),
        ),
      ).rejects.toThrow("Discord API error");
      expect(mockModLogRepository.delete).toHaveBeenCalled();
    });
  });

  describe("type safety", () => {
    test("should enforce type-safe context progression", () => {
      const action = new WarnAction(
        mockGuildId,
        createMockUser(),
        null,
        createMockReason(),
        "unspecified",
      );
      const target = createMockTarget();
      const tx = createMockTransaction();

      // Test initial context
      const initialContext = new ExecutionContext(
        action,
        ActionType.Warn,
        target,
        tx,
      );
      expect(initialContext.hasCaseId()).toBe(false);
      expect(initialContext.hasModerationCase()).toBe(false);

      // Test context with case ID
      const contextWithCaseId = initialContext.setCaseId("123");
      expect(contextWithCaseId).toBeInstanceOf(ExecutionContextWithCaseId);
      expect(contextWithCaseId.getCaseId()).toBe("123");
      expect(contextWithCaseId.hasCaseId()).toBe(true);
      expect(contextWithCaseId.hasModerationCase()).toBe(false);

      // Test complete context
      const moderationCase = ModerationCase.create(
        mockGuildId,
        "123",
        ActionType.Warn,
        target.id,
        target.tag,
        action.executor.id,
        action.reason,
      );
      const completeContext =
        contextWithCaseId.updateModerationCase(moderationCase);
      expect(completeContext).toBeInstanceOf(CompleteExecutionContext);
      expect(completeContext.getCaseId()).toBe("123");
      expect(completeContext.getModerationCase()).toBe(moderationCase);
      expect(completeContext.hasCaseId()).toBe(true);
      expect(completeContext.hasModerationCase()).toBe(true);
      expect(completeContext.hasCaseCreated()).toBe(true);
    });
  });
});

describe("buildAuditLogReason", () => {
  test("omits reason when none given", () => {
    expect(buildAuditLogReason("mod", null, "12")).toBe("By mod");
  });

  test("keeps short reasons intact", () => {
    expect(buildAuditLogReason("mod", "spam", "12")).toBe("By mod: spam");
  });

  test("fits long reasons in 512 chars and points to the case", () => {
    const result = buildAuditLogReason("mod", "x".repeat(3000), "12");

    expect(result.length).toBe(512);
    expect(result.startsWith("By mod: xxx")).toBe(true);
    expect(result.endsWith("… (full reason in case #12)")).toBe(true);
  });
});
