import { describe, expect, mock, test } from "bun:test";
import type { Logger } from "pino";

import { NotificationBlock } from "../domain/entities/NotificationBlock";
import type { NotificationBlockRepository } from "../domain/repositories/NotificationBlockRepository";
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

  const mockLogger = {
    debug: mock(),
    error: mock(),
  };

  const service = new NotificationService(
    mockNotificationRepo,
    mockBlockRepo,
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
});
