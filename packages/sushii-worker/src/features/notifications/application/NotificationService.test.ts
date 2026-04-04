import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";

import { NotificationBlock } from "../domain/entities/NotificationBlock";
import type { NotificationBlockRepository } from "../domain/repositories/NotificationBlockRepository";
import { DEFAULT_USER_NOTIFICATION_SETTINGS } from "../domain/repositories/NotificationUserSettingsRepository";
import { NotificationService } from "./NotificationService";

describe("NotificationService", () => {
  const mockNotificationRepo = {
    add: mock(() => Promise.resolve(true)),
    findByUserAndGuild: mock(() => Promise.resolve([])),
    findByUserGuildAndKeyword: mock(() => Promise.resolve(null)),
    searchByUserAndGuild: mock(() => Promise.resolve([])),
    delete: mock(() => Promise.resolve(true)),
    deleteByUser: mock(() => Promise.resolve()),
    findMatchingNotifications: mock(() => Promise.resolve([])),
    getTotalCount: mock(() => Promise.resolve(0)),
  };

  const mockBlockRepo = {
    add: mock(() => Promise.resolve(true)),
    findByUser: mock(() => Promise.resolve([])),
    delete: mock<NotificationBlockRepository["delete"]>(() =>
      Promise.resolve(null),
    ),
  };

  const mockUserSettingsRepo = {
    setIgnoreUnjoinedThreads: mock(() => Promise.resolve()),
    getSettingsForUsers: mock(() => Promise.resolve(new Map())),
  };

  const mockLogger = {
    debug: mock(),
    error: mock(),
  };

  const service = new NotificationService(
    mockNotificationRepo,
    mockBlockRepo,
    mockUserSettingsRepo,
    mockLogger as unknown as Logger,
  );

  test("adds notification successfully", async () => {
    mockNotificationRepo.add.mockResolvedValue(true);

    const result = await service.addNotification("guild1", "user1", "test");

    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBe(false);
    expect(mockNotificationRepo.add).toHaveBeenCalled();
  });

  test("handles duplicate notification", async () => {
    mockNotificationRepo.add.mockResolvedValue(false);

    const result = await service.addNotification("guild1", "user1", "test");

    expect(result.success).toBe(false);
    expect(result.alreadyExists).toBe(true);
  });

  test("blocks user successfully", async () => {
    mockBlockRepo.add.mockResolvedValue(true);

    const result = await service.blockUser("user1", "blocked1");

    expect(result.success).toBe(true);
    expect(result.alreadyExists).toBe(false);
    expect(mockBlockRepo.add).toHaveBeenCalled();
  });

  test("unblocks successfully", async () => {
    const block = NotificationBlock.createUserBlock("user1", "blocked1");
    mockBlockRepo.delete.mockResolvedValue(block);

    const result = await service.unblock("user1", "blocked1");

    expect(result).toBe(block);
    expect(mockBlockRepo.delete).toHaveBeenCalledWith("user1", "blocked1");
  });

  test("setIgnoreUnjoinedThreads calls repo with correct args", async () => {
    await service.setIgnoreUnjoinedThreads("user1", true);

    expect(mockUserSettingsRepo.setIgnoreUnjoinedThreads).toHaveBeenCalledWith(
      "user1",
      true,
    );
  });

  describe("getUserSettingsMap", () => {
    test("returns empty Map without calling repo when given empty array", async () => {
      mockUserSettingsRepo.getSettingsForUsers.mockClear();

      const result = await service.getUserSettingsMap([]);

      expect(result).toEqual(new Map());
      expect(mockUserSettingsRepo.getSettingsForUsers).not.toHaveBeenCalled();
    });

    test("returns the repo's map when all users have stored settings", async () => {
      const storedSettings = new Map([
        ["user1", { ignoreUnjoinedThreads: true }],
        ["user2", { ignoreUnjoinedThreads: false }],
      ]);
      mockUserSettingsRepo.getSettingsForUsers.mockResolvedValue(storedSettings);

      const result = await service.getUserSettingsMap(["user1", "user2"]);

      expect(result.get("user1")).toEqual({ ignoreUnjoinedThreads: true });
      expect(result.get("user2")).toEqual({ ignoreUnjoinedThreads: false });
    });

    test("fills in defaults for users not present in repo result", async () => {
      // Repo only returns settings for user1; user2 is absent
      const storedSettings = new Map([
        ["user1", { ignoreUnjoinedThreads: true }],
      ]);
      mockUserSettingsRepo.getSettingsForUsers.mockResolvedValue(storedSettings);

      const result = await service.getUserSettingsMap(["user1", "user2"]);

      expect(result.get("user1")).toEqual({ ignoreUnjoinedThreads: true });
      expect(result.get("user2")).toEqual(DEFAULT_USER_NOTIFICATION_SETTINGS);
    });
  });
});
