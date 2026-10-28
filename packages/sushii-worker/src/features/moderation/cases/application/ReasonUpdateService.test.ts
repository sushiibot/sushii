import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Client } from "discord.js";
import pino from "pino";

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
  let editCaseDM: ReturnType<typeof mock>;
  let refresh: ReturnType<typeof mock>;
  let loadEntry: ReturnType<typeof mock>;
  let recordModLogEdit: ReturnType<typeof mock>;

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
      findByIds: mock(() => Promise.resolve([])),
      markDmDeleted: mock(() => Promise.resolve()),
      findLastReason: mock(() => Promise.resolve(null)),
      findRecentDistinctReasons: mock(() => Promise.resolve([])),
      countByNormalizedReason: mock(() => Promise.resolve(0)),
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

    editCaseDM = mock(async () => "updated");
    refresh = mock(async () => "updated");
    loadEntry = mock(async (moderationCase: ModerationCase) => ({
      moderationCase,
      message: {},
      missing: null,
    }));

    recordModLogEdit = mock();
    service = new ReasonUpdateService(
      mockModLogRepository,
      mockGuildConfigRepository,
      mockClient,
      { editCaseDM } as never,
      { loadEntry, refreshEntry: refresh } as never,
      testLogger,
      { recordModLogEdit },
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
      expect(mockModLogRepository.updateReasonBulk).toHaveBeenCalledWith(
        "guild-123",
        "executor-123",
        1,
        1,
        "New reason",
        false,
      );
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

    test("keeps the executor and records who set the reason", async () => {
      const setAt = new Date("2026-10-27T12:00:00.000Z");
      const updated = new ModerationCase(
        "guild-123",
        "1",
        ActionType.Ban,
        new Date(),
        "user-123",
        "TestUser",
        "executor-123",
        Reason.create("New reason").unwrap(),
        "message-123",
      ).withReasonSetBy("setter-456", setAt);
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve([updated]),
      );

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "setter-456",
        caseRangeStr: "1",
        reason: "New reason",
        onlyEmpty: false,
      });

      expect(mockModLogRepository.updateReasonBulk).toHaveBeenCalledWith(
        "guild-123",
        "setter-456",
        1,
        1,
        "New reason",
        false,
      );
      expect(mockModLogRepository.update).not.toHaveBeenCalled();
      const [, rendered] = refresh.mock.calls[0] as unknown as [
        unknown,
        ModerationCase,
      ];
      expect(rendered.executorId).toBe("executor-123");
      expect(rendered.reasonSetBy).toBe("setter-456");
      expect(result.unwrap().modLogUpdates).toEqual([
        { caseId: "1", outcome: "updated" },
      ]);
    });

    test("updateDm edits each case's DM and reports per-case outcomes", async () => {
      const cases = ["1", "2", "3"].map(
        (id) =>
          new ModerationCase(
            "guild-123",
            id,
            ActionType.Warn,
            new Date(),
            "user-123",
            "TestUser",
            "executor-123",
            Reason.create("New reason").unwrap(),
            `message-${id}`,
          ),
      );
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve(cases),
      );
      editCaseDM
        .mockResolvedValueOnce("updated")
        .mockResolvedValueOnce("no_dm")
        .mockResolvedValueOnce("failed");

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1-3",
        reason: "New reason",
        onlyEmpty: false,
        updateDm: true,
      });

      expect(result.unwrap().dmUpdates).toEqual([
        { caseId: "1", outcome: "updated" },
        { caseId: "2", outcome: "no_dm" },
        { caseId: "3", outcome: "failed" },
      ]);
      expect(editCaseDM).toHaveBeenCalledTimes(3);
      expect(recordModLogEdit.mock.calls).toEqual([
        ["dm_edit", "ok"],
        ["dm_edit", "failed"],
      ]);
    });

    test("without updateDm the DMs are left alone", async () => {
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve([
          new ModerationCase(
            "guild-123",
            "1",
            ActionType.Warn,
            new Date(),
            "user-123",
            "TestUser",
            "executor-123",
            null,
          ),
        ]),
      );

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1",
        reason: "New reason",
        onlyEmpty: false,
      });

      expect(editCaseDM).not.toHaveBeenCalled();
      expect(result.unwrap().dmUpdates).toEqual([]);
    });

    test("a pending case has no message yet and isn't an error", async () => {
      const pending = new ModerationCase(
        "guild-123",
        "1",
        ActionType.Ban,
        new Date(),
        "user-123",
        "TestUser",
        "executor-123",
        null,
        null,
        [],
        null,
        true,
      );
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve([pending]),
      );
      refresh.mockResolvedValueOnce("pending");

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1",
        reason: "New reason",
        onlyEmpty: false,
      });

      expect(result.unwrap().errors).toEqual([]);
      expect(result.unwrap().modLogUpdates).toEqual([
        { caseId: "1", outcome: "pending" },
      ]);
    });

    test("skips the mod log refresh for cases the caller re-renders", async () => {
      const mockCase = new ModerationCase(
        "guild-123",
        "1",
        ActionType.Ban,
        new Date(),
        "user-123",
        "TestUser",
        "executor-123",
        null,
        "message-123",
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
        skipModLogRefreshFor: ["1"],
      });

      expect(refresh).not.toHaveBeenCalled();
      expect(loadEntry).not.toHaveBeenCalled();
      expect(result.unwrap().modLogUpdates).toEqual([
        { caseId: "1", outcome: "skipped" },
      ]);
    });

    test("a legacy entry showing the DM as deleted is synced before the DM edit", async () => {
      const live = new ModerationCase(
        "guild-123",
        "1",
        ActionType.Ban,
        new Date(),
        "user-123",
        "TestUser",
        "executor-123",
        Reason.create("New reason").unwrap(),
        "message-1",
        [],
        { channelId: "dm-channel", messageId: "dm-message" },
      );
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve([live]),
      );
      loadEntry.mockImplementationOnce(async (c: ModerationCase) => ({
        moderationCase: c.withDmDeleted(),
        message: {},
        missing: null,
      }));

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1",
        reason: "New reason",
        onlyEmpty: false,
        updateDm: true,
      });

      const [, dmCase] = editCaseDM.mock.calls[0] as unknown as [
        unknown,
        ModerationCase,
      ];
      expect(dmCase.dmDeleted).toBe(true);
      const [, rendered] = refresh.mock.calls[0] as unknown as [
        unknown,
        ModerationCase,
      ];
      expect(rendered.dmDeleted).toBe(true);
      expect(result.unwrap().updatedCases[0]?.dmDeleted).toBe(true);
    });

    test("leaves the DM alone when the posted entry can't be checked", async () => {
      const posted = (id: string, msgId: string | null) =>
        new ModerationCase(
          "guild-123",
          id,
          ActionType.Ban,
          new Date(),
          "user-123",
          "TestUser",
          "executor-123",
          Reason.create("New reason").unwrap(),
          msgId,
          [],
          { channelId: "dm-channel", messageId: "dm-message" },
        );
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve([
          posted("1", "message-1"),
          posted("2", "message-2"),
          posted("3", null),
        ]),
      );
      loadEntry
        .mockImplementationOnce(async (c: ModerationCase) => ({
          moderationCase: c,
          message: null,
          missing: "failed",
        }))
        .mockImplementationOnce(async (c: ModerationCase) => ({
          moderationCase: c,
          message: null,
          missing: "not_configured",
        }))
        .mockImplementationOnce(async (c: ModerationCase) => ({
          moderationCase: c,
          message: null,
          missing: "no_message",
        }));

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1-3",
        reason: "New reason",
        onlyEmpty: false,
        updateDm: true,
      });

      expect(result.unwrap().dmUpdates).toEqual([
        { caseId: "1", outcome: "skipped_unverified" },
        { caseId: "2", outcome: "skipped_unverified" },
        { caseId: "3", outcome: "updated" },
      ]);
      expect(editCaseDM).toHaveBeenCalledTimes(1);
    });

    test("still saves the reason when the mod log isn't configured", async () => {
      const cases = ["1", "2"].map(
        (id) =>
          new ModerationCase(
            "guild-123",
            id,
            ActionType.Warn,
            new Date(),
            "user-123",
            "TestUser",
            "executor-123",
            null,
            `message-${id}`,
          ),
      );
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve(cases),
      );
      refresh.mockResolvedValue("not_configured");

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1-2",
        reason: "New reason",
        onlyEmpty: false,
      });

      expect(result.unwrap().updatedCases).toHaveLength(2);
      expect(result.unwrap().errors).toEqual([
        {
          caseId: "all",
          errorType: "not_configured",
          message: "Mod log is not configured or disabled",
        },
      ]);
    });

    test("reports mod log messages that couldn't be updated", async () => {
      mockModLogRepository.updateReasonBulk = mock(() =>
        Promise.resolve([
          new ModerationCase(
            "guild-123",
            "1",
            ActionType.Warn,
            new Date(),
            "user-123",
            "TestUser",
            "executor-123",
            null,
          ),
        ]),
      );
      refresh.mockResolvedValueOnce("failed");

      const result = await service.updateReasons({
        guildId: "guild-123",
        executorId: "executor-123",
        caseRangeStr: "1",
        reason: "New reason",
        onlyEmpty: false,
      });

      expect(result.unwrap().errors.map((e) => e.errorType)).toEqual([
        "msg_fetch",
      ]);
    });
  });
});
