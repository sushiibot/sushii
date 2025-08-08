import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  notificationBlocksInAppPublic,
  notificationsInAppPublic,
} from "@/infrastructure/database/schema";
import type * as schema from "@/infrastructure/database/schema";
import { PostgresTestDatabase } from "@/test/PostgresTestDatabase";

import { Notification } from "../domain/entities/Notification";
import { DrizzleNotificationRepository } from "./DrizzleNotificationRepository";

describe("DrizzleNotificationRepository (Integration)", () => {
  let testDb: PostgresTestDatabase;
  let db: NodePgDatabase<typeof schema>;
  let repo: DrizzleNotificationRepository;

  beforeAll(async () => {
    testDb = new PostgresTestDatabase();
    db = await testDb.initialize();
    repo = new DrizzleNotificationRepository(db);
  });

  beforeEach(async () => {
    // Clear tables before each test to ensure isolation
    await db.delete(notificationBlocksInAppPublic);
    await db.delete(notificationsInAppPublic);
  });

  afterAll(async () => {
    await testDb?.close();
  });

  test("handles null category correctly in findMatchingNotifications", async () => {
    // Insert test notifications
    const notification1 = Notification.create("123", "456", "test");
    const notification2 = Notification.create("123", "789", "keyword");

    await repo.add(notification1);
    await repo.add(notification2);

    // Test with null category - should still find matches
    const result = await repo.findMatchingNotifications(
      "123", // guildId
      null, // channelCategoryId (null)
      "111", // channelId
      "999", // authorId (should be excluded)
      "test keyword message", // messageContent
    );

    // Should find both notifications since neither user is the author
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.keyword).sort()).toEqual(["keyword", "test"]);
  });

  test("excludes author from notifications", async () => {
    const notification = Notification.create("123", "456", "test");
    await repo.add(notification);

    const result = await repo.findMatchingNotifications(
      "123",
      null,
      "111",
      "456", // same as notification user_id
      "test message",
    );

    // Should exclude the author
    expect(result).toHaveLength(0);
  });

  test("respects channel blocks", async () => {
    const notification = Notification.create("123", "456", "test");
    await repo.add(notification);

    // Add a channel block
    await db.insert(notificationBlocksInAppPublic).values({
      userId: BigInt(456),
      blockId: BigInt("111"),
      blockType: "channel",
    });

    const result = await repo.findMatchingNotifications(
      "123",
      null,
      "111", // blocked channel
      "999",
      "test message",
    );

    // Should be blocked
    expect(result).toHaveLength(0);
  });

  test("respects category blocks when category is not null", async () => {
    const notification = Notification.create("123", "456", "test");
    await repo.add(notification);

    // Add a category block
    await db.insert(notificationBlocksInAppPublic).values({
      userId: BigInt(456),
      blockId: BigInt("222"),
      blockType: "category",
    });

    const result = await repo.findMatchingNotifications(
      "123",
      "222", // blocked category
      "111",
      "999",
      "test message",
    );

    // Should be blocked
    expect(result).toHaveLength(0);
  });

  test("does not match category blocks when category is null", async () => {
    const notification = Notification.create("123", "456", "test");
    await repo.add(notification);

    // Add a category block
    await db.insert(notificationBlocksInAppPublic).values({
      userId: BigInt(456),
      blockId: BigInt("222"),
      blockType: "category",
    });

    const result = await repo.findMatchingNotifications(
      "123",
      null, // null category - should not match category block
      "111",
      "999",
      "test message",
    );

    // Should NOT be blocked since category is null
    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe("test");
  });
});
