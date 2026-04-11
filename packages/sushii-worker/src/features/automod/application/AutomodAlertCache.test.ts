import { beforeEach, describe, expect, test } from "bun:test";

import { AutomodAlertCache } from "./AutomodAlertCache";

describe("AutomodAlertCache", () => {
  let cache: AutomodAlertCache;

  beforeEach(() => {
    cache = new AutomodAlertCache();
  });

  describe("track + consumeRecent", () => {
    test("returns empty array when nothing tracked", () => {
      expect(cache.consumeRecent("guild1", "user1")).toEqual([]);
    });

    test("returns tracked entry", () => {
      cache.track("guild1", "user1", "msg1", "chan1");
      const entries = cache.consumeRecent("guild1", "user1");
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ messageId: "msg1", channelId: "chan1" });
    });

    test("consuming removes entries (not re-reacted on next call)", () => {
      cache.track("guild1", "user1", "msg1", "chan1");
      cache.consumeRecent("guild1", "user1");
      expect(cache.consumeRecent("guild1", "user1")).toHaveLength(0);
    });

    test("consuming cleans up empty guild map", () => {
      cache.track("guild1", "user1", "msg1", "chan1");
      cache.consumeRecent("guild1", "user1");
      // Tracking for a different user in same guild should create a fresh guild map
      cache.track("guild1", "user2", "msg2", "chan1");
      expect(cache.consumeRecent("guild1", "user2")).toHaveLength(1);
    });

    test("tracks multiple entries per user, respects MAX_ENTRIES_PER_USER (5)", () => {
      for (let i = 0; i < 7; i++) {
        cache.track("guild1", "user1", `msg${i}`, "chan1");
      }
      const entries = cache.consumeRecent("guild1", "user1");
      expect(entries).toHaveLength(5);
      // Should keep the most recent 5 (msg2..msg6)
      expect(entries[0]).toMatchObject({ messageId: "msg2" });
      expect(entries[4]).toMatchObject({ messageId: "msg6" });
    });

    test("isolates entries by guildId", () => {
      cache.track("guild1", "user1", "msg1", "chan1");
      expect(cache.consumeRecent("guild2", "user1")).toHaveLength(0);
    });

    test("isolates entries by userId", () => {
      cache.track("guild1", "user1", "msg1", "chan1");
      expect(cache.consumeRecent("guild1", "user2")).toHaveLength(0);
    });

    test("tracks entries for multiple users independently", () => {
      cache.track("guild1", "user1", "msg1", "chan1");
      cache.track("guild1", "user2", "msg2", "chan1");
      expect(cache.consumeRecent("guild1", "user1")).toHaveLength(1);
      expect(cache.consumeRecent("guild1", "user2")).toHaveLength(1);
    });
  });
});
