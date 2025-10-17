import { describe, expect, test } from "bun:test";

import { Notification } from "./Notification";

describe("Notification", () => {
  test("creates valid notification", () => {
    const notification = Notification.create("guild1", "user1", "test");

    expect(notification.guildId).toBe("guild1");
    expect(notification.userId).toBe("user1");
    expect(notification.keyword).toBe("test");
    expect(notification.cleanedKeyword).toBe("test");
  });

  test("cleans keyword to lowercase", () => {
    const notification = Notification.create("guild1", "user1", "  TEST  ");

    expect(notification.cleanedKeyword).toBe("test");
  });

  test("rejects keyword too short", () => {
    expect(() => Notification.create("guild1", "user1", "a")).toThrow(
      "Keyword must be at least 2 characters long",
    );
  });

  test("accepts 2-character keywords", () => {
    const notification = Notification.create("guild1", "user1", "r2");

    expect(notification.keyword).toBe("r2");
    expect(notification.cleanedKeyword).toBe("r2");
  });

  test("rejects keyword too long", () => {
    const longKeyword = "a".repeat(101);
    expect(() => Notification.create("guild1", "user1", longKeyword)).toThrow(
      "Keyword must be no more than 100 characters long",
    );
  });
});
