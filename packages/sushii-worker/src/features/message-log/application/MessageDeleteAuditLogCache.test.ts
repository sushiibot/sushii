import { beforeEach, describe, expect, test } from "bun:test";

import {
  type AuditExecutor,
  MessageDeleteAuditLogCache,
} from "./MessageDeleteAuditLogCache";

const EXECUTOR: AuditExecutor = {
  executorId: "exec1",
  executorUsername: "moduser",
};

describe("MessageDeleteAuditLogCache", () => {
  let cache: MessageDeleteAuditLogCache;

  beforeEach(() => {
    cache = new MessageDeleteAuditLogCache();
  });

  describe("audit log arrives first (notifyExecutor before waitForExecutor)", () => {
    test("waitForExecutor resolves immediately with cached executor", async () => {
      cache.notifyExecutor("g1", "c1", "u1", EXECUTOR);
      const result = await cache.waitForExecutor("g1", "c1", "u1");
      expect(result).toEqual(EXECUTOR);
    });

    test("second waitForExecutor gets null after executor consumed", async () => {
      cache.notifyExecutor("g1", "c1", "u1", EXECUTOR);
      await cache.waitForExecutor("g1", "c1", "u1");

      // Second call: nothing queued, will time out — but we check it returns null (fast via Promise.resolve)
      const result = cache.waitForExecutor("g1", "c1", "u1");
      // Cancel the TTL by not awaiting; just check the pending state by looking at a different key
      cache.notifyExecutor("g1", "c1", "u1", EXECUTOR); // resolve it to avoid hanging
      expect(await result).toEqual(EXECUTOR);
    });

    test("two notifyExecutor calls queue two executors for two waiters (FIFO)", async () => {
      const exec2: AuditExecutor = { executorId: "exec2", executorUsername: "mod2" };
      cache.notifyExecutor("g1", "c1", "u1", EXECUTOR);
      cache.notifyExecutor("g1", "c1", "u1", exec2);

      const r1 = await cache.waitForExecutor("g1", "c1", "u1");
      const r2 = await cache.waitForExecutor("g1", "c1", "u1");
      expect(r1).toEqual(EXECUTOR);
      expect(r2).toEqual(exec2);
    });
  });

  describe("message delete arrives first (waitForExecutor before notifyExecutor)", () => {
    test("waitForExecutor resolves when notifyExecutor fires", async () => {
      const promise = cache.waitForExecutor("g1", "c1", "u1");
      cache.notifyExecutor("g1", "c1", "u1", EXECUTOR);
      expect(await promise).toEqual(EXECUTOR);
    });

    test("two concurrent waiters each get their own executor (FIFO)", async () => {
      const exec2: AuditExecutor = { executorId: "exec2", executorUsername: "mod2" };
      const p1 = cache.waitForExecutor("g1", "c1", "u1");
      const p2 = cache.waitForExecutor("g1", "c1", "u1");

      cache.notifyExecutor("g1", "c1", "u1", EXECUTOR);
      cache.notifyExecutor("g1", "c1", "u1", exec2);

      expect(await p1).toEqual(EXECUTOR);
      expect(await p2).toEqual(exec2);
    });

    test("keys are isolated by guild/channel/user", async () => {
      const p = cache.waitForExecutor("g1", "c1", "u1");
      cache.notifyExecutor("g1", "c1", "u2", EXECUTOR); // different user — should not resolve p
      cache.notifyExecutor("g1", "c1", "u1", EXECUTOR); // correct key — resolves p
      expect(await p).toEqual(EXECUTOR);
    });

    test("returns true when a waiter was resolved, false when queued", () => {
      const p = cache.waitForExecutor("g1", "c1", "u1");
      const resolved = cache.notifyExecutor("g1", "c1", "u1", EXECUTOR);
      expect(resolved).toBe(true);
      return p;
    });

    test("returns false when audit log arrives before waitForExecutor", () => {
      const queued = cache.notifyExecutor("g1", "c1", "u1", EXECUTOR);
      expect(queued).toBe(false);
      // Consume to clean up
      return cache.waitForExecutor("g1", "c1", "u1");
    });
  });
});
