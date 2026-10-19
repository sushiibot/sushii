import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import pino from "pino";

import type { GuildConfig } from "@/shared/domain/entities/GuildConfig";
import type { GuildConfigRepository } from "@/shared/domain/repositories/GuildConfigRepository";

import { ModerationCase } from "../../shared/domain/entities/ModerationCase";
import type { ModLogRepository } from "../../shared/domain/repositories/ModLogRepository";
import { ActionType } from "../../shared/domain/value-objects/ActionType";
import { Reason } from "../../shared/domain/value-objects/Reason";
import { ReasonUpdateService } from "./ReasonUpdateService";

// Silent logger for tests
const testLogger = pino({ level: "silent" });

describe("ReasonUpdateService", () => {
  let service: ReasonUpdateService;
  let mockModLogRepository: ModLogRepository;
  let mockGuildConfigRepository: GuildConfigRepository;
  let mockClient: Client;

  beforeEach(() => {
    mockModLogRepository = {
      createCase: mock(() => Promise.resolve({} as ModerationCase)),
      update: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve()),
      findRecent: mock(() =>
        Promise.resolve([{ caseId: "4" } as ModerationCase]),
      ),
      findById: mock(() => Promise.resolve(null)),
      findByUserIdNotPending: mock(() => Promise.resolve([])),
      findByUserIdsNotPending: mock(() => Promise.resolve([])),
      findByGuildId: mock(() => Promise.resolve([])),
      deleteRange: mock(() => Promise.resolve([])),
      exists: mock(() => Promise.resolve(true)),
      findByRange: mock(() => Promise.resolve([])),
      updateReasonBulk: mock(() => Promise.resolve([])),
      searchByIdPrefix: mock(() => Promise.resolve([])),
      // Audit log methods
      findPendingCase: mock(() => Promise.resolve(null)),
      markAsNotPending: mock(() => Promise.resolve({} as ModerationCase)),
      updateMessageId: mock(() => Promise.resolve()),
      updateDMInfo: mock(() => Promise.resolve()),
      hasAnyForGuild: mock(() => Promise.resolve(false)),
    };

    mockGuildConfigRepository = {
      findByGuildId: mock(() =>
        Promise.resolve({
          loggingSettings: {
            modLogChannel: "log-channel-123",
            modLogEnabled: true,
          },
        }),
      ),
    } as unknown as GuildConfigRepository;

    mockClient = {
      channels: {
        fetch: mock(() =>
          Promise.resolve({
            isTextBased: () => true,
            isSendable: () => true,
            messages: {
              fetch: mock(() =>
                Promise.resolve({
                  embeds: [
                    {
                      fields: [{ name: "Reason", value: "Old reason" }],
                      data: {},
                    },
                  ],
                  edit: mock(() => Promise.resolve()),
                }),
              ),
            },
          }),
        ),
      },
      users: {
        fetch: mock(() =>
          Promise.resolve({
            id: "user-123",
            tag: "TestUser#1234",
            displayAvatarURL: () => "https://example.com/avatar.png",
          }),
        ),
      },
    } as unknown as Client;

    service = new ReasonUpdateService(
      mockModLogRepository,
      mockGuildConfigRepository,
      mockClient,
      testLogger,
    );
  });

  describe("checkExistingReasons", () => {
    test("should validate case range and return cases", async () => {
      const mockCase = new ModerationCase(
        "guild-123",
        "1",
        ActionType.Warn,
        new Date(),
        "user-123",
        "TestUser#1234",
        "executor-123",
        Reason.create("Existing reason").unwrap(),
      );

      mockModLogRepository.findByRange = mock(() =>
        Promise.resolve([mockCase]),
      );

      const result = await service.checkExistingReasons("guild-123", "1");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.cases).toHaveLength(1);
        expect(result.val.hasExistingReasons).toBe(true);
      }
    });

    test("should reject invalid case ranges", async () => {
      const result = await service.checkExistingReasons("guild-123", "invalid");

      expect(result.err).toBe(true);
      if (result.err) {
        expect(result.val).toContain("Invalid case specification");
      }
    });

    test("should reject ranges over 25 cases", async () => {
      const result = await service.checkExistingReasons("guild-123", "1-50");

      expect(result.err).toBe(true);
      if (result.err) {
        expect(result.val).toContain("25 cases");
      }
    });
  });

  describe("updateReasons", () => {
    test("should update case reasons successfully", async () => {
      const mockCase = new ModerationCase(
        "guild-123",
        "1",
        ActionType.Warn,
        new Date(),
        "user-123",
        "TestUser#1234",
        "executor-123",
        null, // No existing reason
        "message-123", // Message ID for mod log
      );

      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve([mockCase]),
      );

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1",
        reason: "New reason",
        onlyEmpty: false,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.val.updatedCases).toHaveLength(1);
        expect(result.val.errors).toHaveLength(0);
      }
    });

    test("should propagate database errors instead of returning them", async () => {
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.reject(new Error("connection lost")),
      );

      await expect(
        service.updateReasons({
          guildId: "guild-123",
          executorId: "executor-123",
          caseRangeStr: "1",
          reason: "New reason",
          onlyEmpty: false,
        }),
      ).rejects.toThrow("connection lost");
    });

    test("should propagate database errors when resolving latest cases", async () => {
      mockModLogRepository.findRecent = mock(() =>
        Promise.reject(new Error("connection lost")),
      );

      await expect(
        service.checkExistingReasons("guild-123", "latest"),
      ).rejects.toThrow("connection lost");
    });

    test("should return error when mod log is not configured", async () => {
      mockGuildConfigRepository.findByGuildId = mock(() =>
        Promise.resolve({
          loggingSettings: {
            modLogChannel: null, // No mod log channel configured
            modLogEnabled: false,
          },
        } as GuildConfig),
      );

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1",
        reason: "New reason",
        onlyEmpty: false,
      });

      expect(result.err).toBe(true);
      if (result.err) {
        expect(result.val).toContain("Mod log is not configured");
      }
    });
  });
});
